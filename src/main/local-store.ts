import { app } from 'electron'
import Database from 'better-sqlite3'
import type { AbilityInstallMeta, AbilityType, AgentRunChanges, AgentRunLedgerEntry, AgentRunRecord, AgentRunStatus, AgentTaskRecord, AgentTaskStatus, ResumableRun, RunErrorKind, AppSettings, Artifact, ArtifactQuery, CompactionHistory, ContextPolicy, ContextState, ContextSummary, ConversationDetailed, ConversationPageQuery, ConversationRunState, ConversationStats, ConversationTurn, ConversationTurnPatch, ClientPreferences, CliToolCheck, FileOperation, FileVersionRecord, HubSource, LocalCliTool, LocalMcpServer, LocalMcpServerInput, LocalModelInput, LocalModelSummary, McpConnectionSnapshot, MemoryListQuery, MemoryRecord, MemoryScope, MemoryUpdateInput, ModelCredentials, PageQuery, PageResult, ProjectRecord, SkillVersionRecord, StoredPermissionRule, TodoItem, ToolCallRecord, TurnContextSource, TurnRuntimeConfig, TurnStatus } from '../shared/types'
import type { ModelUsageOverview, ModelUsageRecord, ModelUsageSummary, TurnSessionAnchor } from '../shared/types'
import type { PermissionAction } from '../shared/permission-rules'
import type { ModelParameterOverride } from '../shared/model-parameters'
import type { StoredPermissionProfile } from '../shared/permission-profiles'
import { LATEST_MODE, LATEST_STATUS } from './local-store/conversation-filter'
import { applyMigrations, SCHEMA_SQL } from './local-store/schema'
import { ModelConnectionStore } from './local-store/model-connections'
import { ModelOverrideStore } from './local-store/model-overrides-store'
import { ModelUsageStore } from './model-usage-store'
import { KbStore } from './kb-store'
import { accountModelId } from './local-store/shared-workspace'
import { AbilityMetaStore } from './local-store/ability-meta-store'
import { AccountStore, storeNamespace, type OutboxItem, type StoredSession } from './local-store/account-store'
import { AgentRunStore } from './local-store/agent-run-store'
import { ArtifactStore } from './local-store/artifact-store'
import { CliToolStore } from './local-store/cli-tool-store'
import { ContextStore } from './local-store/context-store'
import { ConversationStore, type ConversationMessage } from './local-store/conversation-store'
import { HubSourceStore } from './local-store/hub-source-store'
import { LocalModelStore } from './local-store/local-model-store'
import { McpStore } from './local-store/mcp-store'
import { MemoryStore } from './local-store/memory-store'
import { PermissionStore } from './local-store/permission-store'
import { ProjectTrustStore } from './local-store/project-trust-store'
import { SettingsStore } from './local-store/settings-store'
import { SkillVersionStore } from './local-store/skill-version-store'
import type { ConversationRecord } from './local-store/row-mappers'

export type { ConversationRecord } from './local-store/row-mappers'
export type { OutboxItem, StoredSession } from './local-store/account-store'
export type { ConversationMessage } from './local-store/conversation-store'

export interface CachedResource {
  kind: string
  resourceId: string
  payload: unknown
  updatedAt: string
}

/**
 * 本地库门面：建连、建表、迁移，再把各域读写委托给 local-store/ 下的仓库。
 * 方法名与调用形态保持不变；跨域组合（会话详情、统计）留在这一层。
 */
export class LocalStore {
  private readonly db: Database.Database
  private readonly modelConnectionRepository: ModelConnectionStore
  private readonly modelOverrideRepository: ModelOverrideStore
  private readonly modelUsageRepository: ModelUsageStore
  private readonly kbRepository: KbStore
  private readonly abilityMetaRepository: AbilityMetaStore
  private readonly accountRepository: AccountStore
  private readonly agentRunRepository: AgentRunStore
  private readonly artifactRepository: ArtifactStore
  private readonly cliToolRepository: CliToolStore
  private readonly contextRepository: ContextStore
  private readonly conversationRepository: ConversationStore
  private readonly hubSourceRepository: HubSourceStore
  private readonly localModelRepository: LocalModelStore
  private readonly mcpRepository: McpStore
  private readonly memoryRepository: MemoryStore
  private readonly permissionRepository: PermissionStore
  private readonly projectTrustRepository: ProjectTrustStore
  private readonly settingsRepository: SettingsStore
  private readonly skillVersionRepository: SkillVersionStore

  constructor(databasePath?: string) {
    this.db = new Database(databasePath ?? `${app.getPath('userData')}\\fastagent.db`)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA_SQL)
    applyMigrations(this.db)
    this.modelConnectionRepository = new ModelConnectionStore(this.db)
    this.modelOverrideRepository = new ModelOverrideStore(this.db)
    this.modelUsageRepository = new ModelUsageStore(this.db)
    this.kbRepository = new KbStore(this.db)
    this.settingsRepository = new SettingsStore(this.db)
    this.abilityMetaRepository = new AbilityMetaStore(this.db)
    this.accountRepository = new AccountStore(this.db)
    this.agentRunRepository = new AgentRunStore(this.db)
    this.artifactRepository = new ArtifactStore(this.db)
    this.cliToolRepository = new CliToolStore(this.db)
    this.contextRepository = new ContextStore(this.db, () => this.settingsRepository.getSettings())
    this.conversationRepository = new ConversationStore(this.db, {
      deleteModelUsage: (namespace, conversationId) => this.modelUsageRepository.deleteConversation(namespace, conversationId),
      deleteProjectKbEntries: (namespace, projectId) => this.kbRepository.deleteProjectEntries(namespace, projectId)
    })
    this.hubSourceRepository = new HubSourceStore(this.db)
    this.localModelRepository = new LocalModelStore(this.db)
    this.mcpRepository = new McpStore(this.db)
    this.memoryRepository = new MemoryStore(this.db)
    this.permissionRepository = new PermissionStore(this.db)
    this.projectTrustRepository = new ProjectTrustStore(this.db)
    this.skillVersionRepository = new SkillVersionStore(this.db)
  }

  modelConnections(): ModelConnectionStore { return this.modelConnectionRepository }
  listModelOverrides(): Map<string, ModelParameterOverride> { return this.modelOverrideRepository.listModelOverrides() }
  getModelOverride(provider: string, modelName: string): ModelParameterOverride { return this.modelOverrideRepository.getModelOverride(provider, modelName) }
  setModelOverride(provider: string, modelName: string, override: ModelParameterOverride): ModelParameterOverride { return this.modelOverrideRepository.setModelOverride(provider, modelName, override) }
  recordModelUsage(namespace: string, record: ModelUsageRecord): boolean { return this.modelUsageRepository.record(namespace, record) }
  getModelUsage(namespace: string, conversationId: string, turnId?: string): ModelUsageSummary { return this.modelUsageRepository.get(namespace, conversationId, turnId) }
  getModelUsageOverview(namespace: string, days: number): ModelUsageOverview { return this.modelUsageRepository.overview(namespace, days) }
  listKbEntries(namespace: string, projectId: string) { return this.kbRepository.list(namespace, projectId) }
  saveKbEntry(namespace: string, projectId: string, input: { id?: string; title: string; content: string }) { return this.kbRepository.save(namespace, projectId, input) }
  removeKbEntry(namespace: string, projectId: string, entryId: string) { return this.kbRepository.remove(namespace, projectId, entryId) }
  searchKbEntries(namespace: string, projectId: string, plan: { match: string | null; likeTerms: readonly string[] }, limit: number) { return this.kbRepository.search(namespace, projectId, plan, limit) }
  /** 知识来源（文件/目录绑定）：索引流程在 knowledge/kb-indexer.ts，这里只透出存取。 */
  get knowledgeBase() { return this.kbRepository }
  deleteModelUsage(namespace: string, conversationId: string): void { this.modelUsageRepository.deleteConversation(namespace, conversationId) }

  static namespace(backendUrl: string, userId: string) {
    return storeNamespace(backendUrl, userId)
  }

  workspaceModelId(accountNamespace: string, remoteModelId: number): number {
    return accountModelId(this.db, accountNamespace, remoteModelId)
  }

  getSettings(): AppSettings { return this.settingsRepository.getSettings() }
  updateSettings(patch: Partial<AppSettings>): AppSettings { return this.settingsRepository.updateSettings(patch) }
  getClientPreferences(namespace: string | null): ClientPreferences { return this.settingsRepository.getClientPreferences(namespace) }
  updateClientPreferences(namespace: string | null, patch: Partial<ClientPreferences>): ClientPreferences { return this.settingsRepository.updateClientPreferences(namespace, patch) }

  listMcpServers(): LocalMcpServer[] { return this.mcpRepository.listMcpServers() }
  saveMcpServer(input: LocalMcpServerInput): LocalMcpServer { return this.mcpRepository.saveMcpServer(input) }
  setMcpServerEnabled(id: string, enabled: boolean) { return this.mcpRepository.setMcpServerEnabled(id, enabled) }
  listEnabledMcpRuntimeConfigs(): LocalMcpServerInput[] { return this.mcpRepository.listEnabledMcpRuntimeConfigs() }
  getMcpRuntimeConfig(id: string): LocalMcpServerInput | null { return this.mcpRepository.getMcpRuntimeConfig(id) }
  removeMcpServer(id: string) { this.mcpRepository.removeMcpServer(id) }
  listMcpServerTimestamps(): Array<{ id: string; updatedAt: string }> { return this.mcpRepository.listMcpServerTimestamps() }
  listMcpStatus(): Array<{ serverId: string } & McpConnectionSnapshot> { return this.mcpRepository.listMcpStatus() }
  getMcpStatus(serverId: string): McpConnectionSnapshot | null { return this.mcpRepository.getMcpStatus(serverId) }
  setMcpStatus(serverId: string, snapshot: McpConnectionSnapshot) { return this.mcpRepository.setMcpStatus(serverId, snapshot) }
  removeMcpStatus(serverId: string) { this.mcpRepository.removeMcpStatus(serverId) }
  listDisabledMcpTools(serverId: string): string[] { return this.mcpRepository.listDisabledMcpTools(serverId) }
  listAllDisabledMcpTools(): Array<{ serverId: string; toolName: string }> { return this.mcpRepository.listAllDisabledMcpTools() }
  setMcpToolEnabled(serverId: string, toolName: string, enabled: boolean) { this.mcpRepository.setMcpToolEnabled(serverId, toolName, enabled) }
  removeMcpToolState(serverId: string) { this.mcpRepository.removeMcpToolState(serverId) }

  listLocalModels(): LocalModelSummary[] { return this.localModelRepository.listLocalModels() }
  saveLocalModel(dbId: number | null, input: LocalModelInput): LocalModelSummary { return this.localModelRepository.saveLocalModel(dbId, input) }
  getLocalModelRuntimeConfig(dbId: number): Omit<ModelCredentials, 'id'> | null { return this.localModelRepository.getLocalModelRuntimeConfig(dbId) }
  removeLocalModel(dbId: number) { this.localModelRepository.removeLocalModel(dbId) }

  isSkillEnabled(name: string) { return this.skillVersionRepository.isSkillEnabled(name) }
  setSkillEnabled(name: string, enabled: boolean) { this.skillVersionRepository.setSkillEnabled(name, enabled) }
  removeSkillState(name: string) { this.skillVersionRepository.removeSkillState(name) }
  recordSkillVersion(...args: Parameters<SkillVersionStore['recordSkillVersion']>): number { return this.skillVersionRepository.recordSkillVersion(...args) }
  listSkillVersions(name: string): SkillVersionRecord[] { return this.skillVersionRepository.listSkillVersions(name) }
  latestSkillRevision(name: string): number { return this.skillVersionRepository.latestSkillRevision(name) }
  readSkillVersion(name: string, revision: number): string | null { return this.skillVersionRepository.readSkillVersion(name, revision) }
  removeSkillVersions(name: string) { this.skillVersionRepository.removeSkillVersions(name) }

  listAbilityMeta(): AbilityInstallMeta[] { return this.abilityMetaRepository.listAbilityMeta() }
  getAbilityMeta(abilityType: AbilityType, abilityId: string): AbilityInstallMeta | null { return this.abilityMetaRepository.getAbilityMeta(abilityType, abilityId) }
  upsertAbilityMeta(...args: Parameters<AbilityMetaStore['upsertAbilityMeta']>): AbilityInstallMeta { return this.abilityMetaRepository.upsertAbilityMeta(...args) }
  removeAbilityMeta(abilityType: AbilityType, abilityId: string) { this.abilityMetaRepository.removeAbilityMeta(abilityType, abilityId) }
  setAbilityLatestVersion(abilityType: AbilityType, abilityId: string, version: string | null, checkedAt?: string) { this.abilityMetaRepository.setAbilityLatestVersion(abilityType, abilityId, version, checkedAt) }
  touchAbilityUsage(abilityType: AbilityType, abilityId: string, usedAt?: string) { this.abilityMetaRepository.touchAbilityUsage(abilityType, abilityId, usedAt) }
  backfillAbilityMeta(entries: Array<{ abilityType: AbilityType; abilityId: string; installedAt?: string }>) { return this.abilityMetaRepository.backfillAbilityMeta(entries) }

  listHubSources(): HubSource[] { return this.hubSourceRepository.listHubSources() }
  saveHubSource(...args: Parameters<HubSourceStore['saveHubSource']>): HubSource { return this.hubSourceRepository.saveHubSource(...args) }
  getHubSourceApiKey(id: string): string | null { return this.hubSourceRepository.getHubSourceApiKey(id) }
  removeHubSource(id: string) { this.hubSourceRepository.removeHubSource(id) }

  listCliTools(): LocalCliTool[] { return this.cliToolRepository.listCliTools() }
  saveCliTool(input: LocalCliTool): LocalCliTool { return this.cliToolRepository.saveCliTool(input) }
  getCliToolCheck(id: string): CliToolCheck | null { return this.cliToolRepository.getCliToolCheck(id) }
  listCliToolChecks(): Array<{ id: string; check: CliToolCheck }> { return this.cliToolRepository.listCliToolChecks() }
  setCliToolCheck(id: string, check: CliToolCheck) { return this.cliToolRepository.setCliToolCheck(id, check) }
  removeCliTool(id: string) { this.cliToolRepository.removeCliTool(id) }
  listCliToolTimestamps(): Array<{ id: string; updatedAt: string }> { return this.cliToolRepository.listCliToolTimestamps() }

  getContextPolicy(namespace: string, conversationId: string): ContextPolicy | null { return this.contextRepository.getContextPolicy(namespace, conversationId) }
  updateContextPolicy(namespace: string, conversationId: string, patch: Partial<Omit<ContextPolicy, 'conversationId'>>): ContextPolicy { return this.contextRepository.updateContextPolicy(namespace, conversationId, patch) }
  getConversationContextPolicy(namespace: string, conversationId: string) { return this.contextRepository.getConversationContextPolicy(namespace, conversationId) }
  updateConversationContextPolicy(namespace: string, conversationId: string, patch: Partial<Omit<ContextPolicy, 'conversationId'>>) { return this.contextRepository.updateConversationContextPolicy(namespace, conversationId, patch) }
  getModelRuntime(namespace: string, conversationId: string, provider: string, modelId: number) { return this.contextRepository.getModelRuntime(namespace, conversationId, provider, modelId) }
  upsertModelRuntime(...args: Parameters<ContextStore['upsertModelRuntime']>) { this.contextRepository.upsertModelRuntime(...args) }
  listRuntimeModelIds(namespace: string, conversationId: string) { return this.contextRepository.listRuntimeModelIds(namespace, conversationId) }
  getModelRuntimeSessionFile(namespace: string, conversationId: string, provider: string, modelId: number) { return this.contextRepository.getModelRuntimeSessionFile(namespace, conversationId, provider, modelId) }
  setModelRuntimeSessionFile(namespace: string, conversationId: string, provider: string, modelId: number, sessionFile: string) { this.contextRepository.setModelRuntimeSessionFile(namespace, conversationId, provider, modelId, sessionFile) }
  getContextState(namespace: string, conversationId: string): ContextState | null { return this.contextRepository.getContextState(namespace, conversationId) }
  upsertContextState(namespace: string, state: ContextState): ContextState { return this.contextRepository.upsertContextState(namespace, state) }
  saveContextState(namespace: string, state: ContextState) { return this.contextRepository.saveContextState(namespace, state) }
  createContextSummary(...args: Parameters<ContextStore['createContextSummary']>): ContextSummary { return this.contextRepository.createContextSummary(...args) }
  createSummary(...args: Parameters<ContextStore['createSummary']>) { return this.contextRepository.createSummary(...args) }
  getContextSummary(namespace: string, id: string): ContextSummary | null { return this.contextRepository.getContextSummary(namespace, id) }
  listContextSummaries(namespace: string, conversationId: string): ContextSummary[] { return this.contextRepository.listContextSummaries(namespace, conversationId) }
  latestTurnSummary(namespace: string, conversationId: string): ContextSummary | null { return this.contextRepository.latestTurnSummary(namespace, conversationId) }
  listSummaries(namespace: string, conversationId: string) { return this.contextRepository.listSummaries(namespace, conversationId) }
  recordCompaction(...args: Parameters<ContextStore['recordCompaction']>): CompactionHistory { return this.contextRepository.recordCompaction(...args) }
  countCompactions(namespace: string, conversationId: string): number { return this.contextRepository.countCompactions(namespace, conversationId) }
  listCompactionHistory(namespace: string, conversationId: string): CompactionHistory[] { return this.contextRepository.listCompactionHistory(namespace, conversationId) }
  getCompactionHistory(namespace: string, conversationId: string) { return this.contextRepository.getCompactionHistory(namespace, conversationId) }
  listModelRuntimeSessionFiles(namespace: string): Array<{ conversationId: string; sessionFile: string }> { return this.contextRepository.listModelRuntimeSessionFiles(namespace) }
  remapModelRuntimeSessionFiles(namespace: string, conversationId: string, fromDir: string, toDir: string) { this.contextRepository.remapModelRuntimeSessionFiles(namespace, conversationId, fromDir, toDir) }

  saveAccount(session: StoredSession) { this.accountRepository.saveAccount(session) }
  getAccountUsername(namespace: string): string | null { return this.accountRepository.getAccountUsername(namespace) }
  getSessionLayoutVersion(namespace: string): number { return this.accountRepository.getSessionLayoutVersion(namespace) }
  setSessionLayoutVersion(namespace: string, version: number) { this.accountRepository.setSessionLayoutVersion(namespace, version) }
  listConversationSessionBindings(namespace: string): Array<{ conversationId: string; createdAt: string; sessionFile: string | null }> { return this.accountRepository.listConversationSessionBindings(namespace) }
  lock(namespace: string) { this.accountRepository.lock(namespace) }
  getLatestAccount(): StoredSession | null { return this.accountRepository.getLatestAccount() }
  saveResources(backendUrl: string, userId: string, resources: Record<string, unknown>) { this.accountRepository.saveResources(backendUrl, userId, resources) }
  saveModelCredentials(namespace: string, credentials: ModelCredentials[]) { return this.accountRepository.saveModelCredentials(namespace, credentials) }
  listModelCredentials(namespace: string): ModelCredentials[] { return this.accountRepository.listModelCredentials(namespace) }
  clearModelCredentials(namespace: string) { this.accountRepository.clearModelCredentials(namespace) }
  loadResources(backendUrl: string, userId: string): Record<string, unknown> | null { return this.accountRepository.loadResources(backendUrl, userId) }
  enqueueOutbox(...args: Parameters<AccountStore['enqueueOutbox']>) { return this.accountRepository.enqueueOutbox(...args) }
  listDueOutbox(namespace: string, limit?: number): OutboxItem[] { return this.accountRepository.listDueOutbox(namespace, limit) }
  markOutboxAttempt(id: string, attempts: number, nextAttemptAt: string) { this.accountRepository.markOutboxAttempt(id, attempts, nextAttemptAt) }
  removeOutbox(id: string) { this.accountRepository.removeOutbox(id) }

  createConversation(...args: Parameters<ConversationStore['createConversation']>): ConversationRecord { return this.conversationRepository.createConversation(...args) }
  getConversation(namespace: string, id: string): ConversationRecord | null { return this.conversationRepository.getConversation(namespace, id) }
  getConversationRoot(namespace: string, conversationId: string): string | null { return this.conversationRepository.getConversationRoot(namespace, conversationId) }
  listConversationsPage(namespace: string, query?: ConversationPageQuery, archived?: boolean): PageResult<ConversationRecord> { return this.conversationRepository.listConversationsPage(namespace, query, archived) }
  searchConversationsByTitle(namespace: string, keyword: string, projectId: string | null, limit: number): ConversationRecord[] { return this.conversationRepository.searchConversationsByTitle(namespace, keyword, projectId, limit) }
  listConversations(namespace: string, archived?: boolean): ConversationRecord[] { return this.conversationRepository.listConversations(namespace, archived) }
  listRunStates(namespace: string): ConversationRunState[] { return this.conversationRepository.listRunStates(namespace) }
  saveRunState(namespace: string, state: ConversationRunState) { this.conversationRepository.saveRunState(namespace, state) }
  markRunRead(namespace: string, conversationId: string) { this.conversationRepository.markRunRead(namespace, conversationId) }
  appendMessage(...args: Parameters<ConversationStore['appendMessage']>) { this.conversationRepository.appendMessage(...args) }
  listMessages(namespace: string, conversationId: string): ConversationMessage[] { return this.conversationRepository.listMessages(namespace, conversationId) }
  createTurn(...args: Parameters<ConversationStore['createTurn']>): ConversationTurn { return this.conversationRepository.createTurn(...args) }
  getTurn(namespace: string, turnId: string): ConversationTurn | null { return this.conversationRepository.getTurn(namespace, turnId) }
  listTurns(namespace: string, conversationId: string): ConversationTurn[] { return this.conversationRepository.listTurns(namespace, conversationId) }
  latestTurnRuntime(namespace: string, conversationId: string): { runtimeConfig: TurnRuntimeConfig; status: TurnStatus } | null { return this.conversationRepository.latestTurnRuntime(namespace, conversationId) }
  updateTurn(namespace: string, turnId: string, patch: ConversationTurnPatch, known?: ConversationTurn | null): ConversationTurn | null { return this.conversationRepository.updateTurn(namespace, turnId, patch, known) }
  deleteTurn(namespace: string, turnId: string): ConversationTurn | null { return this.conversationRepository.deleteTurn(namespace, turnId) }
  restoreTurn(namespace: string, turn: ConversationTurn): ConversationTurn { return this.conversationRepository.restoreTurn(namespace, turn) }
  deleteTurnsAfter(namespace: string, conversationId: string, turnId: string): string[] { return this.conversationRepository.deleteTurnsAfter(namespace, conversationId, turnId) }
  getTurnSessionAnchor(namespace: string, turnId: string): TurnSessionAnchor | null { return this.conversationRepository.getTurnSessionAnchor(namespace, turnId) }
  setTurnSessionAnchor(namespace: string, turnId: string, anchor: TurnSessionAnchor | null) { this.conversationRepository.setTurnSessionAnchor(namespace, turnId, anchor) }
  renameConversation(namespace: string, id: string, title: string): ConversationRecord | null { return this.conversationRepository.renameConversation(namespace, id, title) }
  archiveConversation(namespace: string, id: string) { this.conversationRepository.archiveConversation(namespace, id) }
  removeConversation(namespace: string, id: string) { this.conversationRepository.removeConversation(namespace, id) }
  clearConversationTurns(namespace: string, conversationId: string): number { return this.conversationRepository.clearConversationTurns(namespace, conversationId) }
  /**
   * 清空一个会话在库里的全部内容：消息、上下文、运行台账、成果登记，以及由它抽出的记忆。
   * 会话条目本身保留（标题重置），磁盘上的 session 文件与附件由调用方清理。
   * 跨域组合放在门面：这几张表分属不同仓库，但「清空会话」要么全清、要么不动。
   */
  purgeConversationContent(namespace: string, conversationId: string): { turns: number; runs: number; artifacts: number; memories: number } {
    const purge = this.db.transaction(() => ({
      turns: this.conversationRepository.clearConversationTurns(namespace, conversationId),
      runs: this.agentRunRepository.deleteConversationRuns(namespace, conversationId),
      artifacts: this.artifactRepository.deleteConversationArtifacts(namespace, conversationId),
      memories: this.memoryRepository.deleteConversationMemories(namespace, conversationId)
    }))
    return purge()
  }
  listProjectsPage(namespace: string, query?: PageQuery, archived?: boolean): PageResult<ProjectRecord> { return this.conversationRepository.listProjectsPage(namespace, query, archived) }
  listProjects(namespace: string, archived?: boolean): ProjectRecord[] { return this.conversationRepository.listProjects(namespace, archived) }
  getProjectByPath(namespace: string, path: string): ProjectRecord | null { return this.conversationRepository.getProjectByPath(namespace, path) }
  upsertProject(...args: Parameters<ConversationStore['upsertProject']>): ProjectRecord { return this.conversationRepository.upsertProject(...args) }
  touchProject(namespace: string, id: string): ProjectRecord | null { return this.conversationRepository.touchProject(namespace, id) }
  archiveProject(namespace: string, id: string) { this.conversationRepository.archiveProject(namespace, id) }
  removeProject(namespace: string, id: string) { this.conversationRepository.removeProject(namespace, id) }
  getConversationModelId(namespace: string, id: string): number | null { return this.conversationRepository.getConversationModelId(namespace, id) }
  setConversationModelId(namespace: string, id: string, modelId: number | null) { this.conversationRepository.setConversationModelId(namespace, id, modelId) }
  getConversationSessionFile(namespace: string, id: string): string | null { return this.conversationRepository.getConversationSessionFile(namespace, id) }
  setConversationSessionFile(namespace: string, id: string, sessionFile: string | null) { this.conversationRepository.setConversationSessionFile(namespace, id, sessionFile) }
  recordToolCall(...args: Parameters<ConversationStore['recordToolCall']>) { this.conversationRepository.recordToolCall(...args) }
  updateToolCall(...args: Parameters<ConversationStore['updateToolCall']>) { this.conversationRepository.updateToolCall(...args) }
  listToolCalls(namespace: string, turnId: string): ToolCallRecord[] { return this.conversationRepository.listToolCalls(namespace, turnId) }
  setTodos(namespace: string, conversationId: string, items: TodoItem[]): TodoItem[] { return this.conversationRepository.setTodos(namespace, conversationId, items) }
  listTodos(namespace: string, conversationId: string): TodoItem[] { return this.conversationRepository.listTodos(namespace, conversationId) }

  getArtifact(namespace: string, artifactId: string): Artifact | null { return this.artifactRepository.getArtifact(namespace, artifactId) }
  listArtifacts(namespace: string, query?: ArtifactQuery): Artifact[] { return this.artifactRepository.listArtifacts(namespace, query) }
  upsertArtifact(...args: Parameters<ArtifactStore['upsertArtifact']>): Artifact { return this.artifactRepository.upsertArtifact(...args) }
  removeArtifact(namespace: string, id: string) { this.artifactRepository.removeArtifact(namespace, id) }
  upsertFileChange(...args: Parameters<ArtifactStore['upsertFileChange']>) { this.artifactRepository.upsertFileChange(...args) }
  removeFileChange(namespace: string, turnId: string, path: string) { this.artifactRepository.removeFileChange(namespace, turnId, path) }
  getFileChange(namespace: string, turnId: string, path: string): { operation: FileOperation; tools: string[]; beforeHash: string | null } | null { return this.artifactRepository.getFileChange(namespace, turnId, path) }
  listFileChanges(namespace: string, turnId: string): AgentRunChanges { return this.artifactRepository.listFileChanges(namespace, turnId) }
  listFileVersions(namespace: string, path: string, conversationId?: string | null, limit?: number): FileVersionRecord[] { return this.artifactRepository.listFileVersions(namespace, path, conversationId, limit) }
  getFileChangeBeforeText(namespace: string, turnId: string, path: string): string | null { return this.artifactRepository.getFileChangeBeforeText(namespace, turnId, path) }
  getFileChangeDiff(namespace: string, turnId: string, path: string): string | null { return this.artifactRepository.getFileChangeDiff(namespace, turnId, path) }

  startAgentRun(...args: Parameters<AgentRunStore['startAgentRun']>) { this.agentRunRepository.startAgentRun(...args) }
  finishAgentRun(namespace: string, runId: string, status: Exclude<AgentRunStatus, 'running'>, error?: string | null, finishedAt?: number, errorKind?: RunErrorKind | null) { this.agentRunRepository.finishAgentRun(namespace, runId, status, error, finishedAt, errorKind) }
  bumpAgentRunRetry(namespace: string, runId: string): number { return this.agentRunRepository.bumpAgentRunRetry(namespace, runId) }
  startAgentTask(...args: Parameters<AgentRunStore['startAgentTask']>) { this.agentRunRepository.startAgentTask(...args) }
  finishAgentTask(namespace: string, taskId: string, patch: { status: Exclude<AgentTaskStatus, 'queued' | 'running'>; summary?: string | null; error?: string | null; finishedAt?: number }) { this.agentRunRepository.finishAgentTask(namespace, taskId, patch) }
  listAgentTasks(namespace: string, query?: { runId?: string; conversationId?: string; turnId?: string; limit?: number }): AgentTaskRecord[] { return this.agentRunRepository.listAgentTasks(namespace, query) }
  listAgentRunLedger(namespace: string, conversationId: string, limit?: number): AgentRunLedgerEntry[] { return this.agentRunRepository.listAgentRunLedger(namespace, conversationId, limit) }
  markInterruptedAgentRuns(namespace: string, activeRunIds?: readonly string[]): number { return this.agentRunRepository.markInterruptedAgentRuns(namespace, activeRunIds) }
  getAgentRun(namespace: string, runId: string): AgentRunRecord | null { return this.agentRunRepository.getAgentRun(namespace, runId) }
  findResumableRun(namespace: string, conversationId: string): ResumableRun | null { return this.agentRunRepository.findResumableRun(namespace, conversationId) }

  listMemories(namespace: string, query?: MemoryListQuery): PageResult<MemoryRecord> { return this.memoryRepository.listMemories(namespace, query) }
  recordMemoryRecalls(namespace: string, conversationId: string, turnId: string, memoryIds: string[], now?: number): void { this.memoryRepository.recordMemoryRecalls(namespace, conversationId, turnId, memoryIds, now) }
  listMemoryRecallsForTurn(namespace: string, turnId: string): Array<MemoryRecord & { recalledAt: number }> { return this.memoryRepository.listMemoryRecallsForTurn(namespace, turnId) }
  recordTurnContextSources(namespace: string, conversationId: string, turnId: string, sources: readonly Omit<TurnContextSource, 'recordedAt'>[], now?: number): void { this.memoryRepository.recordTurnContextSources(namespace, conversationId, turnId, sources, now) }
  listTurnContextSources(namespace: string, turnId: string): TurnContextSource[] { return this.memoryRepository.listTurnContextSources(namespace, turnId) }
  listContextSourceTurnIds(namespace: string, conversationId: string): string[] { return this.memoryRepository.listContextSourceTurnIds(namespace, conversationId) }
  listMemoryActivityTurnIds(namespace: string, conversationId: string): string[] { return this.memoryRepository.listMemoryActivityTurnIds(namespace, conversationId) }
  countMemories(namespace: string, scope?: MemoryScope, scopeId?: string | null): number { return this.memoryRepository.countMemories(namespace, scope, scopeId) }
  searchMemories(...args: Parameters<MemoryStore['searchMemories']>): MemoryRecord[] { return this.memoryRepository.searchMemories(...args) }
  listActiveMemoriesForScopes(namespace: string, input: { workspaceId: string | null; agentId?: string | null; limit?: number }): MemoryRecord[] { return this.memoryRepository.listActiveMemoriesForScopes(namespace, input) }
  getMemory(namespace: string, id: string): MemoryRecord | null { return this.memoryRepository.getMemory(namespace, id) }
  createMemory(...args: Parameters<MemoryStore['createMemory']>): MemoryRecord { return this.memoryRepository.createMemory(...args) }
  updateMemory(namespace: string, id: string, patch: MemoryUpdateInput): MemoryRecord | null { return this.memoryRepository.updateMemory(namespace, id, patch) }
  supersedeMemory(namespace: string, oldId: string, newId: string) { this.memoryRepository.supersedeMemory(namespace, oldId, newId) }
  refreshMemory(namespace: string, id: string, importance: number) { this.memoryRepository.refreshMemory(namespace, id, importance) }
  touchMemories(namespace: string, ids: readonly string[]) { this.memoryRepository.touchMemories(namespace, ids) }
  removeMemory(namespace: string, id: string) { this.memoryRepository.removeMemory(namespace, id) }
  clearMemories(namespace: string, scope?: MemoryScope, scopeId?: string | null): number { return this.memoryRepository.clearMemories(namespace, scope, scopeId) }

  listPermissionRules(namespace: string): StoredPermissionRule[] { return this.permissionRepository.listPermissionRules(namespace) }
  upsertPermissionRule(namespace: string, input: { toolKey: string; pattern: string; action: PermissionAction }) { this.permissionRepository.upsertPermissionRule(namespace, input) }
  removePermissionRule(namespace: string, toolKey: string, pattern: string) { this.permissionRepository.removePermissionRule(namespace, toolKey, pattern) }
  isProjectTrusted(namespace: string, projectPath: string): boolean { return this.projectTrustRepository.isTrusted(namespace, projectPath) }
  getProjectTrust(namespace: string, projectPath: string) { return this.projectTrustRepository.get(namespace, projectPath) }
  setProjectTrust(namespace: string, projectPath: string, trusted: boolean) { this.projectTrustRepository.set(namespace, projectPath, trusted) }
  listPermissionProfiles(namespace: string): StoredPermissionProfile[] { return this.permissionRepository.listPermissionProfiles(namespace) }
  savePermissionProfile(namespace: string, profile: StoredPermissionProfile) { this.permissionRepository.savePermissionProfile(namespace, profile) }
  removePermissionProfile(namespace: string, profileId: string) { this.permissionRepository.removePermissionProfile(namespace, profileId) }

  getConversationDetailed(namespace: string, conversationId: string): ConversationDetailed | null {
    const conversation = this.getConversation(namespace, conversationId)
    if (!conversation) return null
    const latest = this.latestTurnRuntime(namespace, conversationId)
    const sessionFile = this.getConversationSessionFile(namespace, conversationId)
    const context = this.getContextState(namespace, conversationId)
    const summaryId = context?.latestSummaryId ?? null
    return {
      ...conversation,
      runtime: {
        mode: latest?.runtimeConfig.mode ?? null,
        // 绑定优先于末轮记录：会话里切了模型但还没发消息时，运行态也应报新模型。
        modelId: conversation.modelId ?? latest?.runtimeConfig.modelId ?? null,
        provider: null,
        thinkingLevel: latest?.runtimeConfig.thinkingLevel ?? null,
        permission: latest?.runtimeConfig.permission ?? null,
        status: latest?.status ?? null,
        sessionId: sessionFile
      },
      context,
      summary: summaryId ? this.getContextSummary(namespace, summaryId) : null,
      compactionHistory: this.listCompactionHistory(namespace, conversationId),
      contextPolicy: this.getContextPolicy(namespace, conversationId)
    }
  }

  listConversationsDetailed(namespace: string, archived = false): ConversationDetailed[] {
    return this.listConversations(namespace, archived).map((item) => this.getConversationDetailed(namespace, item.id) as ConversationDetailed)
  }

  /** 统计卡片走全库聚合：分页之后按当前页统计已经不代表任何东西。 */
  conversationStats(namespace: string, includeArchived = false): ConversationStats {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN ? OR archived = 0 THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN archived = 0 AND ${LATEST_STATUS} = 'working' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN archived = 0 AND ${LATEST_MODE} = 'agent' THEN 1 ELSE 0 END) AS agent,
        SUM(CASE WHEN archived = 0 AND ${LATEST_STATUS} = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM conversations WHERE namespace = ?
    `).get(includeArchived ? 1 : 0, namespace) as { total: number | null; active: number | null; agent: number | null; failed: number | null }
    return { total: row.total ?? 0, active: row.active ?? 0, agent: row.agent ?? 0, failed: row.failed ?? 0 }
  }

  listConversationsDetailedPage(namespace: string, query: ConversationPageQuery = {}, archived = false): PageResult<ConversationDetailed> {
    const page = this.listConversationsPage(namespace, query, archived)
    return { ...page, items: page.items.map((item) => this.getConversationDetailed(namespace, item.id) as ConversationDetailed) }
  }

  getConversationInspector(namespace: string, conversationId: string): ConversationDetailed | null {
    return this.getConversationDetailed(namespace, conversationId)
  }


  close() {
    this.db.close()
  }
}
