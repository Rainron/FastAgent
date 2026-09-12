import { app } from 'electron'
import Database from 'better-sqlite3'
import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AbilityInstallMeta, AbilitySource, AbilityType, AgentFileChange, AgentRunChanges, AgentRunLedgerEntry, AgentRunRecord, AgentRunStatus, ResumableRun, RunErrorKind, AgentTaskRecord, AgentTaskStatus, ConversationMode, AppSettings, Artifact, ArtifactQuery, ArtifactReference, Attachment, Citation, FileOperation, ClientPreferences, CliToolCheck, CompactionHistory, ContextPolicy, ContextState, ContextStrategy, ContextSummary, ConversationDetailed, ConversationPageQuery, ConversationRunState, ConversationStats, ConversationTurn, HubSource, HubSourceInput, HubSourceKind, LocalCliTool, PageQuery, PageResult, ConversationTurnPatch, LocalMcpServer, LocalMcpServerInput, LocalModelInput, LocalModelSummary, McpConnectionSnapshot, MemoryListQuery, MemoryRecord, MemoryScope, MemoryType, MemoryUpdateInput, ModelCredentials, ProjectRecord, StoredPermissionRule, TodoItem, ToolCallRecord, TurnActivity, TurnRuntimeConfig, TurnStatus } from '../shared/types'
import type { PermissionAction } from '../shared/permission-rules'
import { sanitizeOverrides, type BuiltinPermissionPreset, type StoredPermissionProfile } from '../shared/permission-profiles'
import { normalizeSandboxSettings } from '../shared/sandbox'
import { normalizePageSize, pageOffset, resolvePage } from '../shared/pagination'
import { conversationFilter, LATEST_MODE, LATEST_STATUS } from './local-store/conversation-filter'
import { applyMigrations, SCHEMA_SQL } from './local-store/schema'
import { ModelConnectionStore } from './local-store/model-connections'
import { ModelUsageStore } from './model-usage-store'
import { accountModelId } from './local-store/shared-workspace'
import type { ModelUsageRecord, ModelUsageSummary } from '../shared/types'
import {
  defaultClientPreferences, defaultRuntimeConfig, defaultSettings, emptyConnectionSnapshot, mapAbilityMeta, mapConversation,
  mapAgentRun, mapAgentTask, mapMemory, normalizeMemorySettings, normalizeRuntimeConfig, normalizeTurnActivity, parseJson,
  type AbilityMetaRow, type AgentRunRow, type AgentTaskRow, type ConversationRecord, type ConversationRow, type MemoryRow, type TurnRow
} from './local-store/row-mappers'

export type { ConversationRecord } from './local-store/row-mappers'

export interface StoredSession {
  backendUrl: string
  userId: string
  refreshToken: string | null
  /** 只在登录/恢复时拿得到；session 目录的用户段用它。 */
  username?: string | null
}

export interface CachedResource {
  kind: string
  resourceId: string
  payload: unknown
  updatedAt: string
}

export interface OutboxItem {
  id: string
  namespace: string
  payload: unknown
  attempts: number
  nextAttemptAt: string
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  text: string
  createdAt: string
}

type TurnPatch = ConversationTurnPatch

export class LocalStore {
  private readonly db: Database.Database
  private readonly modelConnectionRepository: ModelConnectionStore
  private readonly modelUsageRepository: ModelUsageStore

  constructor(databasePath?: string) {
    this.db = new Database(databasePath ?? `${app.getPath('userData')}\fastagent.db`)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA_SQL)
    applyMigrations(this.db)
    this.modelConnectionRepository = new ModelConnectionStore(this.db)
    this.modelUsageRepository = new ModelUsageStore(this.db)
  }

  modelConnections(): ModelConnectionStore { return this.modelConnectionRepository }
  recordModelUsage(namespace: string, record: ModelUsageRecord): boolean { return this.modelUsageRepository.record(namespace, record) }
  getModelUsage(namespace: string, conversationId: string, turnId?: string): ModelUsageSummary { return this.modelUsageRepository.get(namespace, conversationId, turnId) }
  deleteModelUsage(namespace: string, conversationId: string): void { this.modelUsageRepository.deleteConversation(namespace, conversationId) }

  static namespace(backendUrl: string, userId: string) {
    return `${backendUrl.replace(/\/$/, '').toLowerCase()}::${userId}`
  }

  workspaceModelId(accountNamespace: string, remoteModelId: number): number {
    return accountModelId(this.db, accountNamespace, remoteModelId)
  }

  getSettings(): AppSettings {
    const row = this.db.prepare('SELECT payload FROM app_settings WHERE key = ?').get('global') as { payload: string } | undefined
    const stored = parseJson<Partial<AppSettings>>(row?.payload, {})
    // sandbox 为嵌套对象，浅合并救不了缺字段的旧记录，单独归一化。
    return { ...defaultSettings, ...stored, sandbox: normalizeSandboxSettings(stored.sandbox).settings, memory: normalizeMemorySettings(stored.memory) }
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...patch }
    this.db.prepare(`
      INSERT INTO app_settings(key, payload, updated_at) VALUES ('global', ?, ?)
      ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(JSON.stringify(next), new Date().toISOString())
    return next
  }

  listMcpServers(): LocalMcpServer[] {
    const rows = this.db.prepare('SELECT id, payload, secrets FROM local_mcp_servers ORDER BY updated_at ASC, id ASC').all() as Array<{ id: string; payload: string; secrets: Buffer | null }>
    return rows.map((row) => ({ ...parseJson<Omit<LocalMcpServer, 'hasSecrets'>>(row.payload, {} as Omit<LocalMcpServer, 'hasSecrets'>), id: row.id, hasSecrets: Boolean(row.secrets) }))
  }

  saveMcpServer(input: LocalMcpServerInput): LocalMcpServer {
    const existing = this.db.prepare('SELECT secrets FROM local_mcp_servers WHERE id = ?').get(input.id) as { secrets: Buffer | null } | undefined
    const secretInputProvided = input.env !== undefined || input.headers !== undefined
    const secrets = { env: input.env ?? {}, headers: input.headers ?? {} }
    let encrypted = existing?.secrets ?? null
    if (secretInputProvided) {
      const hasSecrets = Object.keys(secrets.env).length > 0 || Object.keys(secrets.headers).length > 0
      if (hasSecrets && !safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，不能保存 MCP 密钥')
      encrypted = hasSecrets ? safeStorage.encryptString(JSON.stringify(secrets)) : null
    }
    const { env: _env, headers: _headers, ...publicPayload } = input
    this.db.prepare(`
      INSERT INTO local_mcp_servers(id, payload, secrets, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, secrets = excluded.secrets, updated_at = excluded.updated_at
    `).run(input.id, JSON.stringify(publicPayload), encrypted, new Date().toISOString())
    return this.listMcpServers().find((item) => item.id === input.id) as LocalMcpServer
  }

  setMcpServerEnabled(id: string, enabled: boolean) {
    const current = this.listMcpServers().find((item) => item.id === id)
    if (!current) throw new Error(`MCP Server 不存在：${id}`)
    return this.saveMcpServer({ ...current, enabled })
  }

  listEnabledMcpRuntimeConfigs(): LocalMcpServerInput[] {
    return this.listMcpRuntimeConfigs().filter((config) => config.enabled)
  }

  getMcpRuntimeConfig(id: string): LocalMcpServerInput | null {
    return this.listMcpRuntimeConfigs().find((config) => config.id === id) ?? null
  }

  private listMcpRuntimeConfigs(): LocalMcpServerInput[] {
    const rows = this.db.prepare('SELECT id, payload, secrets FROM local_mcp_servers ORDER BY updated_at ASC, id ASC').all() as Array<{ id: string; payload: string; secrets: Buffer | null }>
    return rows.map((row) => {
      const payload = parseJson<Omit<LocalMcpServerInput, 'env' | 'headers'>>(row.payload, {} as Omit<LocalMcpServerInput, 'env' | 'headers'>)
      let secrets: { env?: Record<string, string>; headers?: Record<string, string> } = {}
      if (row.secrets) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error(`无法解密 MCP Server：${payload.name}`)
        secrets = parseJson(safeStorage.decryptString(row.secrets), {})
      }
      return { ...payload, id: row.id, env: secrets.env ?? {}, headers: secrets.headers ?? {} }
    })
  }

  removeMcpServer(id: string) {
    this.db.prepare('DELETE FROM local_mcp_servers WHERE id = ?').run(id)
  }

  /**
   * 本地模型列表（对外只读形态）。id 对外取负，与云端正整数隔离；
   * secrets 只回传 hasApiKey，密钥本身绝不出主进程。
   */
  listLocalModels(): LocalModelSummary[] {
    const rows = this.db.prepare('SELECT id, payload, secrets, updated_at FROM local_models ORDER BY updated_at ASC, id ASC').all() as Array<{ id: number; payload: string; secrets: Buffer | null; updated_at: string }>
    return rows.map((row) => {
      const payload = parseJson<Omit<LocalModelInput, 'api_key' | 'headers'>>(row.payload, {} as Omit<LocalModelInput, 'api_key' | 'headers'>)
      const legacyProtocol = (['openai', 'anthropic', 'openai-responses'] as string[]).includes(payload.provider) ? payload.provider as 'openai' | 'anthropic' | 'openai-responses' : 'openai'
      const protocol = payload.protocol ?? legacyProtocol
      const provider = payload.protocol ? payload.provider : payload.name
      return {
        ...payload,
        provider,
        protocol,
        id: -row.id,
        hasApiKey: Boolean(row.secrets),
        updatedAt: row.updated_at
      } as LocalModelSummary
    })
  }

  /**
   * 新增（dbId 为 null）或更新本地模型。api_key / headers 加密存 secrets；
   * 更新时两者缺省表示保留旧值，显式传空字符串 / 空对象表示清空。
   */
  saveLocalModel(dbId: number | null, input: LocalModelInput): LocalModelSummary {
    const existing = dbId !== null
      ? this.db.prepare('SELECT secrets FROM local_models WHERE id = ?').get(dbId) as { secrets: Buffer | null } | undefined
      : undefined
    let encrypted = existing?.secrets ?? null
    // 只有本次显式提供了 api_key / headers 才需要解密旧密钥做字段级合并；
    // 两者都缺省时直接保留原密文，避免无谓解密。
    if (input.api_key !== undefined || input.headers !== undefined) {
      let current: { api_key?: string; headers?: Record<string, string> } = {}
      if (existing?.secrets) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法读取本地模型密钥')
        current = parseJson(safeStorage.decryptString(existing.secrets), {})
      }
      const secrets: { api_key?: string; headers?: Record<string, string> } = { ...current }
      if (input.api_key !== undefined) {
        if (input.api_key) secrets.api_key = input.api_key
        else delete secrets.api_key
      }
      if (input.headers !== undefined) {
        if (Object.keys(input.headers).length) secrets.headers = input.headers
        else delete secrets.headers
      }
      const hasSecrets = Object.keys(secrets).length > 0
      if (hasSecrets && !safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，不能保存 API Key')
      encrypted = hasSecrets ? safeStorage.encryptString(JSON.stringify(secrets)) : null
    }
    const { api_key: _apiKey, headers: _headers, ...payload } = input
    const now = new Date().toISOString()
    if (dbId === null) {
      const result = this.db.prepare('INSERT INTO local_models(payload, secrets, updated_at) VALUES (?, ?, ?)').run(JSON.stringify(payload), encrypted, now)
      dbId = Number(result.lastInsertRowid)
    } else {
      this.db.prepare('UPDATE local_models SET payload = ?, secrets = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(payload), encrypted, now, dbId)
    }
    return this.listLocalModels().find((item) => item.id === -dbId) as LocalModelSummary
  }

  /** 本地模型完整运行配置：解密合并 api_key / headers，供主进程组装 ModelCredentials。 */
  getLocalModelRuntimeConfig(dbId: number): Omit<ModelCredentials, 'id'> | null {
    const row = this.db.prepare('SELECT payload, secrets FROM local_models WHERE id = ?').get(dbId) as { payload: string; secrets: Buffer | null } | undefined
    if (!row) return null
    const payload = parseJson<Omit<LocalModelInput, 'api_key' | 'headers'>>(row.payload, {} as Omit<LocalModelInput, 'api_key' | 'headers'>)
    const legacyProtocol = (['openai', 'anthropic', 'openai-responses'] as string[]).includes(payload.provider) ? payload.provider as 'openai' | 'anthropic' | 'openai-responses' : 'openai'
    const protocol = payload.protocol ?? legacyProtocol
    const provider = payload.protocol ? payload.provider : payload.name
    let secrets: { api_key?: string; headers?: Record<string, string> } = {}
    if (row.secrets) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法读取本地模型密钥')
      secrets = parseJson(safeStorage.decryptString(row.secrets), {})
    }
    return { ...payload, provider, protocol, api_key: secrets.api_key ?? '', headers: secrets.headers }
  }

  removeLocalModel(dbId: number) {
    this.db.prepare('DELETE FROM local_models WHERE id = ?').run(dbId)
  }

  isSkillEnabled(name: string) {
    const row = this.db.prepare('SELECT enabled FROM local_skill_state WHERE name = ?').get(name) as { enabled: number } | undefined
    return Boolean(row?.enabled)
  }

  setSkillEnabled(name: string, enabled: boolean) {
    this.db.prepare(`
      INSERT INTO local_skill_state(name, enabled, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `).run(name, enabled ? 1 : 0, new Date().toISOString())
  }

  removeSkillState(name: string) {
    this.db.prepare('DELETE FROM local_skill_state WHERE name = ?').run(name)
  }

  listAbilityMeta(): AbilityInstallMeta[] {
    const rows = this.db.prepare('SELECT * FROM ability_install_meta').all() as AbilityMetaRow[]
    return rows.map(mapAbilityMeta)
  }

  getAbilityMeta(abilityType: AbilityType, abilityId: string): AbilityInstallMeta | null {
    const row = this.db.prepare('SELECT * FROM ability_install_meta WHERE ability_type = ? AND ability_id = ?').get(abilityType, abilityId) as AbilityMetaRow | undefined
    return row ? mapAbilityMeta(row) : null
  }

  upsertAbilityMeta(input: { abilityType: AbilityType; abilityId: string; source: AbilitySource; pluginId?: string | null; sourceId?: string | null; version?: string | null; installedAt?: string }): AbilityInstallMeta {
    const now = new Date().toISOString()
    const existing = this.getAbilityMeta(input.abilityType, input.abilityId)
    const installedAt = input.installedAt ?? existing?.installedAt ?? now
    this.db.prepare(`
      INSERT INTO ability_install_meta(ability_type, ability_id, source, plugin_id, source_id, version, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ability_type, ability_id) DO UPDATE SET source = excluded.source, plugin_id = excluded.plugin_id,
        source_id = excluded.source_id, version = excluded.version, installed_at = excluded.installed_at, updated_at = excluded.updated_at
    `).run(input.abilityType, input.abilityId, input.source, input.pluginId ?? null, input.sourceId ?? null, input.version ?? null, installedAt, now)
    return this.getAbilityMeta(input.abilityType, input.abilityId) as AbilityInstallMeta
  }

  removeAbilityMeta(abilityType: AbilityType, abilityId: string) {
    this.db.prepare('DELETE FROM ability_install_meta WHERE ability_type = ? AND ability_id = ?').run(abilityType, abilityId)
  }

  /** 目录/表里有、meta 表没有的能力补一条来源记录；无法区分新建与导入时按 imported 处理，风险更高的一侧优先。 */
  backfillAbilityMeta(entries: Array<{ abilityType: AbilityType; abilityId: string; installedAt?: string }>) {
    const known = new Set(this.listAbilityMeta().map((meta) => `${meta.abilityType}::${meta.abilityId}`))
    const pending = entries.filter((entry) => !known.has(`${entry.abilityType}::${entry.abilityId}`))
    if (!pending.length) return 0
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO ability_install_meta(ability_type, ability_id, source, plugin_id, version, installed_at, updated_at)
      VALUES (?, ?, 'imported', NULL, NULL, ?, ?)
    `)
    const now = new Date().toISOString()
    this.db.transaction(() => {
      for (const entry of pending) insert.run(entry.abilityType, entry.abilityId, entry.installedAt ?? now, now)
    })()
    return pending.length
  }

  /** MCP Server 行的 updated_at，用于 meta 回填的 installed_at。 */
  listMcpServerTimestamps(): Array<{ id: string; updatedAt: string }> {
    const rows = this.db.prepare('SELECT id, updated_at FROM local_mcp_servers').all() as Array<{ id: string; updated_at: string }>
    return rows.map((row) => ({ id: row.id, updatedAt: row.updated_at }))
  }

  listMcpStatus(): Array<{ serverId: string } & McpConnectionSnapshot> {
    const rows = this.db.prepare('SELECT server_id, payload FROM mcp_status_cache').all() as Array<{ server_id: string; payload: string }>
    return rows.map((row) => ({ serverId: row.server_id, ...parseJson<McpConnectionSnapshot>(row.payload, emptyConnectionSnapshot()) }))
  }

  getMcpStatus(serverId: string): McpConnectionSnapshot | null {
    const row = this.db.prepare('SELECT payload FROM mcp_status_cache WHERE server_id = ?').get(serverId) as { payload: string } | undefined
    return row ? parseJson<McpConnectionSnapshot>(row.payload, emptyConnectionSnapshot()) : null
  }

  /** 只落工具描述与错误文本；env/headers 一律不进这张表。 */
  setMcpStatus(serverId: string, snapshot: McpConnectionSnapshot) {
    const safe: McpConnectionSnapshot = {
      state: snapshot.state,
      testedAt: snapshot.testedAt,
      error: snapshot.error ?? null,
      toolCount: snapshot.toolCount,
      resourceCount: snapshot.resourceCount,
      promptCount: snapshot.promptCount,
      tools: snapshot.tools.map((tool) => ({ name: tool.name, description: tool.description, annotations: tool.annotations }))
    }
    this.db.prepare(`
      INSERT INTO mcp_status_cache(server_id, payload, tested_at) VALUES (?, ?, ?)
      ON CONFLICT(server_id) DO UPDATE SET payload = excluded.payload, tested_at = excluded.tested_at
    `).run(serverId, JSON.stringify(safe), safe.testedAt ?? new Date().toISOString())
    return safe
  }

  removeMcpStatus(serverId: string) {
    this.db.prepare('DELETE FROM mcp_status_cache WHERE server_id = ?').run(serverId)
  }

  /**
   * 单台 Server 上被显式禁用的工具名。默认不落行，缺行即启用——
   * Server 侧新增工具时不应因为本地没有记录就被静默屏蔽。
   */
  listDisabledMcpTools(serverId: string): string[] {
    const rows = this.db.prepare('SELECT tool_name FROM mcp_tool_state WHERE server_id = ? AND enabled = 0').all(serverId) as Array<{ tool_name: string }>
    return rows.map((row) => row.tool_name)
  }

  listAllDisabledMcpTools(): Array<{ serverId: string; toolName: string }> {
    const rows = this.db.prepare('SELECT server_id, tool_name FROM mcp_tool_state WHERE enabled = 0').all() as Array<{ server_id: string; tool_name: string }>
    return rows.map((row) => ({ serverId: row.server_id, toolName: row.tool_name }))
  }

  setMcpToolEnabled(serverId: string, toolName: string, enabled: boolean) {
    this.db.prepare(`
      INSERT INTO mcp_tool_state(server_id, tool_name, enabled) VALUES (?, ?, ?)
      ON CONFLICT(server_id, tool_name) DO UPDATE SET enabled = excluded.enabled
    `).run(serverId, toolName, enabled ? 1 : 0)
  }

  removeMcpToolState(serverId: string) {
    this.db.prepare('DELETE FROM mcp_tool_state WHERE server_id = ?').run(serverId)
  }

  listHubSources(): HubSource[] {
    const rows = this.db.prepare('SELECT id, kind, payload, secrets, enabled, sort_order, updated_at FROM ability_sources ORDER BY sort_order ASC, id ASC')
      .all() as Array<{ id: string; kind: HubSourceKind; payload: string; secrets: Buffer | null; enabled: number; sort_order: number; updated_at: string }>
    return rows.map((row) => ({
      ...parseJson<Omit<HubSource, 'id' | 'kind' | 'enabled' | 'sortOrder' | 'hasSecrets' | 'updatedAt'>>(row.payload, {} as never),
      id: row.id,
      kind: row.kind,
      enabled: row.enabled === 1,
      sortOrder: row.sort_order,
      hasSecrets: Boolean(row.secrets),
      updatedAt: row.updated_at
    }))
  }

  /** apiKey 走 secrets BLOB，与 MCP 密钥同一条加密路径；未传 apiKey 时保留原值。 */
  saveHubSource(input: HubSourceInput & { builtin?: boolean; status?: HubSource['status']; statusMessage?: string | null; checkedAt?: string }): HubSource {
    const existing = this.db.prepare('SELECT secrets FROM ability_sources WHERE id = ?').get(input.id) as { secrets: Buffer | null } | undefined
    let encrypted = existing?.secrets ?? null
    if (input.apiKey !== undefined) {
      const value = input.apiKey.trim()
      if (value && !safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，不能保存源的 API Key')
      encrypted = value ? safeStorage.encryptString(value) : null
    }
    const previous = this.listHubSources().find((item) => item.id === input.id)
    const payload = {
      name: input.name,
      url: input.url,
      ref: input.ref,
      builtin: input.builtin ?? previous?.builtin ?? false,
      status: input.status ?? previous?.status ?? 'untested',
      statusMessage: input.statusMessage ?? previous?.statusMessage ?? null,
      checkedAt: input.checkedAt ?? previous?.checkedAt
    }
    this.db.prepare(`
      INSERT INTO ability_sources(id, kind, payload, secrets, enabled, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, payload = excluded.payload, secrets = excluded.secrets,
        enabled = excluded.enabled, sort_order = excluded.sort_order, updated_at = excluded.updated_at
    `).run(input.id, input.kind, JSON.stringify(payload), encrypted, input.enabled ? 1 : 0, input.sortOrder ?? previous?.sortOrder ?? 0, new Date().toISOString())
    return this.listHubSources().find((item) => item.id === input.id) as HubSource
  }

  /** 源的 API Key 明文，只在主进程发请求时取。 */
  getHubSourceApiKey(id: string): string | null {
    const row = this.db.prepare('SELECT secrets FROM ability_sources WHERE id = ?').get(id) as { secrets: Buffer | null } | undefined
    if (!row?.secrets) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error(`无法解密源密钥：${id}`)
    return safeStorage.decryptString(row.secrets)
  }

  removeHubSource(id: string) {
    this.db.prepare('DELETE FROM ability_sources WHERE id = ?').run(id)
  }

  listCliTools(): LocalCliTool[] {
    const rows = this.db.prepare('SELECT id, payload FROM local_cli_tools ORDER BY updated_at ASC, id ASC').all() as Array<{ id: string; payload: string }>
    return rows.map((row) => ({ ...parseJson<Omit<LocalCliTool, 'id'>>(row.payload, {} as never), id: row.id }))
  }

  saveCliTool(input: LocalCliTool): LocalCliTool {
    const { id: _id, ...payload } = input
    this.db.prepare(`
      INSERT INTO local_cli_tools(id, payload, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(input.id, JSON.stringify(payload), new Date().toISOString())
    return this.listCliTools().find((item) => item.id === input.id) as LocalCliTool
  }

  getCliToolCheck(id: string): CliToolCheck | null {
    const row = this.db.prepare('SELECT check_result FROM local_cli_tools WHERE id = ?').get(id) as { check_result: string | null } | undefined
    return row?.check_result ? parseJson<CliToolCheck | null>(row.check_result, null) : null
  }

  listCliToolChecks(): Array<{ id: string; check: CliToolCheck }> {
    const rows = this.db.prepare('SELECT id, check_result FROM local_cli_tools WHERE check_result IS NOT NULL').all() as Array<{ id: string; check_result: string }>
    return rows.flatMap((row) => {
      const check = parseJson<CliToolCheck | null>(row.check_result, null)
      return check ? [{ id: row.id, check }] : []
    })
  }

  setCliToolCheck(id: string, check: CliToolCheck) {
    this.db.prepare('UPDATE local_cli_tools SET check_result = ? WHERE id = ?').run(JSON.stringify(check), id)
    return check
  }

  removeCliTool(id: string) {
    this.db.prepare('DELETE FROM local_cli_tools WHERE id = ?').run(id)
  }

  /** CLI 工具行的 updated_at，用于 meta 回填的 installed_at。 */
  listCliToolTimestamps(): Array<{ id: string; updatedAt: string }> {
    const rows = this.db.prepare('SELECT id, updated_at FROM local_cli_tools').all() as Array<{ id: string; updated_at: string }>
    return rows.map((row) => ({ id: row.id, updatedAt: row.updated_at }))
  }

  getClientPreferences(namespace: string | null): ClientPreferences {
    const globalRow = this.db.prepare('SELECT payload FROM client_preferences WHERE scope = ?').get('global') as { payload: string } | undefined
    const accountRow = namespace ? this.db.prepare('SELECT payload FROM client_preferences WHERE scope = ?').get(namespace) as { payload: string } | undefined : undefined
    const globalPreferences = parseJson<Partial<ClientPreferences>>(globalRow?.payload, {})
    const merged = {
      ...defaultClientPreferences(),
      ...globalPreferences,
      ...parseJson<Partial<ClientPreferences>>(accountRow?.payload, {})
    }
    // 页长只认 global：account scope 排在后面，旧库里残留的这个字段会永远盖掉全局设置
    return { ...merged, paginationPageSize: normalizePageSize(globalPreferences.paginationPageSize) }
  }

  updateClientPreferences(namespace: string | null, patch: Partial<ClientPreferences>): ClientPreferences {
    const globalPatch: Partial<ClientPreferences> = {}
    const accountPatch: Partial<ClientPreferences> = {}
    if (patch.recentServers !== undefined) globalPatch.recentServers = patch.recentServers
    if (patch.modePrompts !== undefined) globalPatch.modePrompts = patch.modePrompts
    if (patch.favoriteModelIds !== undefined) accountPatch.favoriteModelIds = patch.favoriteModelIds
    if (patch.recentModelIds !== undefined) accountPatch.recentModelIds = patch.recentModelIds
    if (patch.selectedModelId !== undefined) accountPatch.selectedModelId = patch.selectedModelId
    if (patch.sidebarSections !== undefined) globalPatch.sidebarSections = patch.sidebarSections
    // 页长是跨账号的全局偏好；写进 account scope 会在读取时反向覆盖 global
    if (patch.paginationPageSize !== undefined) globalPatch.paginationPageSize = normalizePageSize(patch.paginationPageSize)
    const save = (scope: string, nextPatch: Partial<ClientPreferences>) => {
      if (!Object.keys(nextPatch).length) return
      const row = this.db.prepare('SELECT payload FROM client_preferences WHERE scope = ?').get(scope) as { payload: string } | undefined
      const next = { ...parseJson<Partial<ClientPreferences>>(row?.payload, {}), ...nextPatch }
      this.db.prepare(`
        INSERT INTO client_preferences(scope, payload, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(scope) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `).run(scope, JSON.stringify(next), new Date().toISOString())
    }
    save('global', globalPatch)
    if (namespace) save(namespace, accountPatch)
    return this.getClientPreferences(namespace)
  }

  getContextPolicy(namespace: string, conversationId: string): ContextPolicy | null {
    const row = this.db.prepare('SELECT * FROM conversation_context_policy WHERE namespace = ? AND conversation_id = ?').get(namespace, conversationId) as {
      conversation_id: string; strategy: ContextStrategy; auto_summary: number; trigger_ratio: number | null; keep_recent_turns: number | null; inherit_global: number
    } | undefined
    return row ? {
      conversationId: row.conversation_id,
      strategy: row.strategy,
      autoSummary: Boolean(row.auto_summary),
      triggerRatio: row.trigger_ratio,
      keepRecentTurns: row.keep_recent_turns,
      inheritGlobal: Boolean(row.inherit_global)
    } : null
  }

  updateContextPolicy(namespace: string, conversationId: string, patch: Partial<Omit<ContextPolicy, 'conversationId'>>): ContextPolicy {
    const current = this.getContextPolicy(namespace, conversationId)
    const next: ContextPolicy = {
      conversationId,
      strategy: patch.strategy ?? current?.strategy ?? this.getSettings().contextStrategy,
      autoSummary: patch.autoSummary ?? current?.autoSummary ?? this.getSettings().autoSummary,
      triggerRatio: patch.triggerRatio === undefined ? (current?.triggerRatio ?? this.getSettings().triggerRatio) : patch.triggerRatio,
      keepRecentTurns: patch.keepRecentTurns === undefined ? (current?.keepRecentTurns ?? this.getSettings().keepRecentTurns) : patch.keepRecentTurns,
      inheritGlobal: patch.inheritGlobal ?? current?.inheritGlobal ?? true
    }
    this.db.prepare(`
      INSERT INTO conversation_context_policy(namespace, conversation_id, strategy, auto_summary, trigger_ratio, keep_recent_turns, inherit_global)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, conversation_id) DO UPDATE SET strategy=excluded.strategy, auto_summary=excluded.auto_summary,
        trigger_ratio=excluded.trigger_ratio, keep_recent_turns=excluded.keep_recent_turns, inherit_global=excluded.inherit_global
    `).run(namespace, conversationId, next.strategy, next.autoSummary ? 1 : 0, next.triggerRatio, next.keepRecentTurns, next.inheritGlobal ? 1 : 0)
    return next
  }

  getConversationContextPolicy(namespace: string, conversationId: string) {
    return this.getContextPolicy(namespace, conversationId)
  }

  updateConversationContextPolicy(namespace: string, conversationId: string, patch: Partial<Omit<ContextPolicy, 'conversationId'>>) {
    return this.updateContextPolicy(namespace, conversationId, patch)
  }

  getModelRuntime(namespace: string, conversationId: string, provider: string, modelId: number) {
    return this.db.prepare('SELECT * FROM conversation_model_runtime WHERE namespace = ? AND conversation_id = ? AND provider = ? AND model_id = ?').get(namespace, conversationId, provider, modelId) as {
      session_file: string | null; context_window: number; estimated_tokens: number; message_tokens: number; tool_tokens: number; system_tokens: number; summary_tokens: number; attachment_tokens: number; counting_method: 'provider-usage' | 'fallback-estimate'; compaction_count: number; updated_at: string
    } | undefined ?? null
  }

  upsertModelRuntime(namespace: string, input: { conversationId: string; provider: string; modelId: number; sessionFile?: string | null; context: ContextState }) {
    const now = input.context.updatedAt || new Date().toISOString()
    this.db.prepare(`
      INSERT INTO conversation_model_runtime(namespace, conversation_id, provider, model_id, session_file, context_window, estimated_tokens, message_tokens, tool_tokens, system_tokens, summary_tokens, attachment_tokens, counting_method, compaction_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, conversation_id, provider, model_id) DO UPDATE SET session_file=COALESCE(excluded.session_file, conversation_model_runtime.session_file), context_window=excluded.context_window, estimated_tokens=excluded.estimated_tokens, message_tokens=excluded.message_tokens, tool_tokens=excluded.tool_tokens, system_tokens=excluded.system_tokens, summary_tokens=excluded.summary_tokens, attachment_tokens=excluded.attachment_tokens, counting_method=excluded.counting_method, compaction_count=excluded.compaction_count, updated_at=excluded.updated_at
    `).run(namespace, input.conversationId, input.provider, input.modelId, input.sessionFile ?? null, input.context.contextWindow, input.context.estimatedTokens, input.context.messageTokens, input.context.toolTokens, input.context.systemTokens, input.context.summaryTokens ?? 0, input.context.attachmentTokens ?? 0, input.context.countingMethod ?? 'fallback-estimate', input.context.compactionCount, now)
  }

  /**
   * 该会话是否已在这个 provider 下跑过。session 现在按会话共用，
   * 同 provider 换模型可以直接接着跑；跨 provider 的消息格式（尤其 thinking 签名块）
   * 不保证能被新 provider 接受，只有这种情况才需要先摘要再重开 session。
   */
  hasProviderRuntime(namespace: string, conversationId: string, provider: string) {
    const row = this.db.prepare('SELECT 1 FROM conversation_model_runtime WHERE namespace = ? AND conversation_id = ? AND provider = ? LIMIT 1').get(namespace, conversationId, provider)
    return Boolean(row)
  }

  getModelRuntimeSessionFile(namespace: string, conversationId: string, provider: string, modelId: number) {
    return this.getModelRuntime(namespace, conversationId, provider, modelId)?.session_file ?? null
  }

  setModelRuntimeSessionFile(namespace: string, conversationId: string, provider: string, modelId: number, sessionFile: string) {
    this.db.prepare('UPDATE conversation_model_runtime SET session_file = ?, updated_at = ? WHERE namespace = ? AND conversation_id = ? AND provider = ? AND model_id = ?').run(sessionFile, new Date().toISOString(), namespace, conversationId, provider, modelId)
  }

  getContextState(namespace: string, conversationId: string): ContextState | null {
    const row = this.db.prepare('SELECT * FROM conversation_context_state WHERE namespace = ? AND conversation_id = ?').get(namespace, conversationId) as {
      conversation_id: string; context_window: number; estimated_tokens: number; message_tokens: number; tool_tokens: number; system_tokens: number; compaction_count: number; latest_summary_id: string | null; updated_at: string
    } | undefined
    return row ? {
      conversationId: row.conversation_id,
      contextWindow: row.context_window,
      estimatedTokens: row.estimated_tokens,
      messageTokens: row.message_tokens,
      toolTokens: row.tool_tokens,
      systemTokens: row.system_tokens,
      compactionCount: row.compaction_count,
      latestSummaryId: row.latest_summary_id,
      updatedAt: row.updated_at
    } : null
  }

  upsertContextState(namespace: string, state: ContextState): ContextState {
    const updatedAt = state.updatedAt || new Date().toISOString()
    this.db.prepare(`
      INSERT INTO conversation_context_state(namespace, conversation_id, context_window, estimated_tokens, message_tokens, tool_tokens, system_tokens, compaction_count, latest_summary_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, conversation_id) DO UPDATE SET context_window=excluded.context_window, estimated_tokens=excluded.estimated_tokens,
        message_tokens=excluded.message_tokens, tool_tokens=excluded.tool_tokens, system_tokens=excluded.system_tokens,
        compaction_count=excluded.compaction_count, latest_summary_id=excluded.latest_summary_id, updated_at=excluded.updated_at
    `).run(namespace, state.conversationId, state.contextWindow, state.estimatedTokens, state.messageTokens, state.toolTokens, state.systemTokens, state.compactionCount, state.latestSummaryId, updatedAt)
    return { ...state, updatedAt }
  }

  saveContextState(namespace: string, state: ContextState) {
    return this.upsertContextState(namespace, state)
  }

  createContextSummary(namespace: string, input: Omit<ContextSummary, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): ContextSummary {
    const summary: ContextSummary = { ...input, id: input.id ?? `summary-${randomUUID()}`, createdAt: input.createdAt ?? new Date().toISOString() }
    this.db.prepare(`
      INSERT INTO conversation_summaries(namespace, id, conversation_id, version, summary_text, covered_turn_start, covered_turn_end, input_tokens, output_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(namespace, summary.id, summary.conversationId, summary.version, summary.summaryText, summary.coveredTurnStart, summary.coveredTurnEnd, summary.inputTokens, summary.outputTokens, summary.createdAt)
    return summary
  }

  createSummary(namespace: string, input: Omit<ContextSummary, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) {
    return this.createContextSummary(namespace, input)
  }

  getContextSummary(namespace: string, id: string): ContextSummary | null {
    const row = this.db.prepare('SELECT * FROM conversation_summaries WHERE namespace = ? AND id = ?').get(namespace, id) as {
      id: string; conversation_id: string; version: number; summary_text: string; covered_turn_start: string | null; covered_turn_end: string | null; input_tokens: number; output_tokens: number; created_at: string
    } | undefined
    return row ? { id: row.id, conversationId: row.conversation_id, version: row.version, summaryText: row.summary_text, coveredTurnStart: row.covered_turn_start, coveredTurnEnd: row.covered_turn_end, inputTokens: row.input_tokens, outputTokens: row.output_tokens, createdAt: row.created_at } : null
  }

  listContextSummaries(namespace: string, conversationId: string): ContextSummary[] {
    const rows = this.db.prepare('SELECT * FROM conversation_summaries WHERE namespace = ? AND conversation_id = ? ORDER BY version ASC, created_at ASC').all(namespace, conversationId) as Array<{ id: string; conversation_id: string; version: number; summary_text: string; covered_turn_start: string | null; covered_turn_end: string | null; input_tokens: number; output_tokens: number; created_at: string }>
    return rows.map((row) => ({ id: row.id, conversationId: row.conversation_id, version: row.version, summaryText: row.summary_text, coveredTurnStart: row.covered_turn_start, coveredTurnEnd: row.covered_turn_end, inputTokens: row.input_tokens, outputTokens: row.output_tokens, createdAt: row.created_at }))
  }

  listSummaries(namespace: string, conversationId: string) {
    return this.listContextSummaries(namespace, conversationId)
  }

  recordCompaction(namespace: string, input: Omit<CompactionHistory, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): CompactionHistory {
    const record: CompactionHistory = { ...input, id: input.id ?? `compaction-${randomUUID()}`, createdAt: input.createdAt ?? new Date().toISOString() }
    this.db.prepare(`
      INSERT INTO conversation_compactions(namespace, id, conversation_id, strategy, trigger_reason, before_tokens, after_tokens, covered_turn_start, covered_turn_end, summary_id, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(namespace, record.id, record.conversationId, record.strategy, record.triggerReason, record.beforeTokens, record.afterTokens, record.coveredTurnStart, record.coveredTurnEnd, record.summaryId, record.durationMs, record.createdAt)
    return record
  }

  /** 只要条数时走 COUNT，不必把整段压缩历史读出来再取 length。 */
  countCompactions(namespace: string, conversationId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM conversation_compactions WHERE namespace = ? AND conversation_id = ?').get(namespace, conversationId) as { count: number }
    return row.count
  }

  listCompactionHistory(namespace: string, conversationId: string): CompactionHistory[] {
    const rows = this.db.prepare('SELECT * FROM conversation_compactions WHERE namespace = ? AND conversation_id = ? ORDER BY created_at DESC, id DESC').all(namespace, conversationId) as Array<{ id: string; conversation_id: string; strategy: ContextStrategy; trigger_reason: string; before_tokens: number; after_tokens: number; covered_turn_start: string | null; covered_turn_end: string | null; summary_id: string | null; duration_ms: number; created_at: string }>
    return rows.map((row) => ({ id: row.id, conversationId: row.conversation_id, strategy: row.strategy, triggerReason: row.trigger_reason, beforeTokens: row.before_tokens, afterTokens: row.after_tokens, coveredTurnStart: row.covered_turn_start, coveredTurnEnd: row.covered_turn_end, summaryId: row.summary_id, durationMs: row.duration_ms, createdAt: row.created_at }))
  }

  getCompactionHistory(namespace: string, conversationId: string) {
    return this.listCompactionHistory(namespace, conversationId)
  }

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

  saveAccount(session: StoredSession) {
    const namespace = LocalStore.namespace(session.backendUrl, session.userId)
    const encrypted = session.refreshToken && safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(session.refreshToken)
      : null
    // 续期回调拿不到 username，用 COALESCE 保住已有值，避免刷新一次就把 session 路径的用户段抹回 userId。
    this.db.prepare(`
      INSERT INTO accounts(namespace, backend_url, user_id, refresh_token, username, locked, updated_at)
      VALUES (@namespace, @backendUrl, @userId, @refreshToken, @username, 0, @updatedAt)
      ON CONFLICT(namespace) DO UPDATE SET refresh_token=excluded.refresh_token, username=COALESCE(excluded.username, accounts.username), locked=0, updated_at=excluded.updated_at
    `).run({ namespace, backendUrl: session.backendUrl, userId: session.userId, refreshToken: encrypted, username: session.username ?? null, updatedAt: new Date().toISOString() })
  }

  getAccountUsername(namespace: string): string | null {
    const row = this.db.prepare('SELECT username FROM accounts WHERE namespace = ?').get(namespace) as { username: string | null } | undefined
    return row?.username ?? null
  }

  getSessionLayoutVersion(namespace: string): number {
    const row = this.db.prepare('SELECT session_layout_version FROM accounts WHERE namespace = ?').get(namespace) as { session_layout_version: number } | undefined
    return row?.session_layout_version ?? 0
  }

  setSessionLayoutVersion(namespace: string, version: number) {
    this.db.prepare('UPDATE accounts SET session_layout_version = ? WHERE namespace = ?').run(version, namespace)
  }

  /** session 目录迁移用：只取路径相关的三列，不碰整段历史。 */
  listConversationSessionBindings(namespace: string): Array<{ conversationId: string; createdAt: string; sessionFile: string | null }> {
    const rows = this.db.prepare('SELECT conversation_id, created_at, session_file FROM conversations WHERE namespace = ?').all(namespace) as Array<{ conversation_id: string; created_at: string; session_file: string | null }>
    return rows.map((row) => ({ conversationId: row.conversation_id, createdAt: row.created_at, sessionFile: row.session_file }))
  }

  /** session 目录迁移用：按模型分桶时代留下的路径也要一起搬。 */
  listModelRuntimeSessionFiles(namespace: string): Array<{ conversationId: string; sessionFile: string }> {
    const rows = this.db.prepare("SELECT conversation_id, session_file FROM conversation_model_runtime WHERE namespace = ? AND session_file IS NOT NULL AND session_file <> ''").all(namespace) as Array<{ conversation_id: string; session_file: string }>
    return rows.map((row) => ({ conversationId: row.conversation_id, sessionFile: row.session_file }))
  }

  /** 旧的按模型分桶列里还留着老目录下的路径，迁移时按目录前缀一起改写。 */
  remapModelRuntimeSessionFiles(namespace: string, conversationId: string, fromDir: string, toDir: string) {
    this.db.prepare(`
      UPDATE conversation_model_runtime SET session_file = ? || substr(session_file, ?), updated_at = ?
      WHERE namespace = ? AND conversation_id = ? AND session_file IS NOT NULL AND substr(session_file, 1, ?) = ?
    `).run(toDir, fromDir.length + 1, new Date().toISOString(), namespace, conversationId, fromDir.length, fromDir)
  }

  lock(namespace: string) {
    this.db.prepare('UPDATE accounts SET locked = 1, updated_at = ? WHERE namespace = ?').run(new Date().toISOString(), namespace)
  }

  getLatestAccount(): StoredSession | null {
    const row = this.db.prepare('SELECT * FROM accounts ORDER BY updated_at DESC LIMIT 1').get() as { backend_url: string; user_id: string; refresh_token: Buffer | null; locked: number } | undefined
    if (!row || !row.refresh_token || row.locked || !safeStorage.isEncryptionAvailable()) return null
    try {
      return { backendUrl: row.backend_url, userId: row.user_id, refreshToken: safeStorage.decryptString(row.refresh_token) }
    } catch {
      return null
    }
  }

  saveResources(backendUrl: string, userId: string, resources: Record<string, unknown>) {
    const namespace = LocalStore.namespace(backendUrl, userId)
    const statement = this.db.prepare(`
      INSERT INTO resource_cache(namespace, kind, resource_id, payload, updated_at)
      VALUES (@namespace, @kind, @resourceId, @payload, @updatedAt)
      ON CONFLICT(namespace, kind, resource_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
    `)
    const now = new Date().toISOString()
    const transaction = this.db.transaction(() => {
      for (const [kind, payload] of Object.entries(resources)) {
        statement.run({ namespace, kind, resourceId: 'bootstrap', payload: JSON.stringify(payload), updatedAt: now })
      }
    })
    transaction()
  }

  /** 模型密钥只以 safeStorage 密文落盘；系统不支持加密时不落盘，本次会话仅靠内存缓存。 */
  saveModelCredentials(namespace: string, credentials: ModelCredentials[]) {
    if (!safeStorage.isEncryptionAvailable()) return false
    const statement = this.db.prepare(`
      INSERT INTO model_credentials(namespace, model_id, payload, updated_at)
      VALUES (@namespace, @modelId, @payload, @updatedAt)
      ON CONFLICT(namespace, model_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
    `)
    const now = new Date().toISOString()
    const keep = credentials.map((item) => item.id)
    this.db.transaction(() => {
      for (const credential of credentials) {
        statement.run({ namespace, modelId: credential.id, payload: safeStorage.encryptString(JSON.stringify(credential)), updatedAt: now })
      }
      // 服务端撤销授权的模型，本地凭证同步清掉，避免离线继续可用。
      const placeholders = keep.map(() => '?').join(',')
      this.db.prepare(`DELETE FROM model_credentials WHERE namespace = ?${keep.length ? ` AND model_id NOT IN (${placeholders})` : ''}`).run(namespace, ...keep)
    })()
    return true
  }

  listModelCredentials(namespace: string): ModelCredentials[] {
    if (!safeStorage.isEncryptionAvailable()) return []
    const rows = this.db.prepare('SELECT model_id, payload FROM model_credentials WHERE namespace = ?').all(namespace) as Array<{ model_id: number; payload: Buffer }>
    const result: ModelCredentials[] = []
    for (const row of rows) {
      try { result.push(JSON.parse(safeStorage.decryptString(row.payload)) as ModelCredentials) }
      catch { /* 换机器或换用户后解不开，等下次登录重新下发 */ }
    }
    return result
  }

  clearModelCredentials(namespace: string) {
    this.db.prepare('DELETE FROM model_credentials WHERE namespace = ?').run(namespace)
  }

  loadResources(backendUrl: string, userId: string): Record<string, unknown> | null {
    const namespace = LocalStore.namespace(backendUrl, userId)
    const rows = this.db.prepare('SELECT kind, payload FROM resource_cache WHERE namespace = ?').all(namespace) as Array<{ kind: string; payload: string }>
    if (!rows.length) return null
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      try { result[row.kind] = JSON.parse(row.payload) } catch { /* 忽略损坏缓存，等待下次在线刷新 */ }
    }
    return Object.keys(result).length ? result : null
  }

  enqueueOutbox(namespace: string, payload: unknown, id = randomUUID()) {
    this.db.prepare('INSERT INTO outbox(id, namespace, payload, attempts, next_attempt_at) VALUES (?, ?, ?, 0, ?)').run(id, namespace, JSON.stringify(payload), new Date().toISOString())
    return id
  }

  listDueOutbox(namespace: string, limit = 20): OutboxItem[] {
    const rows = this.db.prepare('SELECT * FROM outbox WHERE namespace = ? AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?').all(namespace, new Date().toISOString(), limit) as Array<{ id: string; namespace: string; payload: string; attempts: number; next_attempt_at: string }>
    return rows.map((row) => ({ id: row.id, namespace: row.namespace, payload: JSON.parse(row.payload), attempts: row.attempts, nextAttemptAt: row.next_attempt_at }))
  }

  markOutboxAttempt(id: string, attempts: number, nextAttemptAt: string) {
    this.db.prepare('UPDATE outbox SET attempts = ?, next_attempt_at = ? WHERE id = ?').run(attempts, nextAttemptAt, id)
  }

  removeOutbox(id: string) {
    this.db.prepare('DELETE FROM outbox WHERE id = ?').run(id)
  }

  createConversation(namespace: string, input: { id: string; title: string; createdAt?: string; projectId?: string | null }): ConversationRecord {
    const createdAt = input.createdAt ?? new Date().toISOString()
    this.db.prepare(`
      INSERT INTO conversations(namespace, conversation_id, title, created_at, updated_at, archived, project_id)
      VALUES (?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(namespace, conversation_id) DO UPDATE SET title = excluded.title, archived = 0, project_id = excluded.project_id
    `).run(namespace, input.id, input.title, createdAt, createdAt, input.projectId ?? null)
    return this.getConversation(namespace, input.id) as ConversationRecord
  }

  getConversation(namespace: string, id: string): ConversationRecord | null {
    const row = this.db.prepare(`
      SELECT conversation_id, title, created_at, updated_at, archived, project_id, model_id
      FROM conversations WHERE namespace = ? AND conversation_id = ?
    `).get(namespace, id) as ConversationRow | undefined
    return row ? mapConversation(row) : null
  }

  /** 会话归属项目的目录；未归属返回 null。运行时 cwd 只认这个，避免用进程级「当前工作区」串到别的会话。 */
  getConversationRoot(namespace: string, conversationId: string): string | null {
    const row = this.db.prepare(`
      SELECT projects.path AS path
      FROM conversations JOIN projects
        ON projects.namespace = conversations.namespace AND projects.project_id = conversations.project_id
      WHERE conversations.namespace = ? AND conversations.conversation_id = ?
    `).get(namespace, conversationId) as { path: string } | undefined
    return row?.path ?? null
  }

  listConversationsPage(namespace: string, query: ConversationPageQuery = {}, archived = false): PageResult<ConversationRecord> {
    const pageSize = normalizePageSize(query.pageSize)
    const { where, params } = conversationFilter(namespace, query, archived)
    const { count } = this.db.prepare(`SELECT COUNT(*) AS count FROM conversations WHERE ${where}`).get(...params) as { count: number }
    const page = resolvePage(query.page, count, pageSize)
    const rows = this.db.prepare(`
      SELECT conversation_id, title, created_at, updated_at, archived, project_id, model_id
      FROM conversations WHERE ${where}
      ORDER BY updated_at DESC, conversation_id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, pageOffset(page, pageSize)) as ConversationRow[]
    return { items: rows.map(mapConversation), total: count, page, pageSize }
  }

  listConversations(namespace: string, archived = false): ConversationRecord[] {
    const rows = this.db.prepare(`
      SELECT conversation_id, title, created_at, updated_at, archived, project_id, model_id
      FROM conversations WHERE namespace = ? AND archived = ?
      ORDER BY updated_at DESC, conversation_id DESC
    `).all(namespace, archived ? 1 : 0) as ConversationRow[]
    return rows.map(mapConversation)
  }

  listRunStates(namespace: string): ConversationRunState[] {
    const rows = this.db.prepare('SELECT conversation_id, project_id, status, unread, updated_at FROM conversation_run_states WHERE namespace = ?').all(namespace) as Array<{ conversation_id: string; project_id: string | null; status: ConversationRunState['status']; unread: number; updated_at: number }>
    return rows.map((row) => ({ conversationId: row.conversation_id, projectId: row.project_id, status: row.status, hasUnreadResult: Boolean(row.unread), updatedAt: row.updated_at }))
  }

  saveRunState(namespace: string, state: ConversationRunState) {
    this.db.prepare(`INSERT INTO conversation_run_states(namespace, conversation_id, project_id, status, unread, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(namespace, conversation_id) DO UPDATE SET project_id=excluded.project_id, status=excluded.status, unread=excluded.unread, updated_at=excluded.updated_at`).run(namespace, state.conversationId, state.projectId, state.status, state.hasUnreadResult ? 1 : 0, state.updatedAt)
  }

  markRunRead(namespace: string, conversationId: string) {
    this.db.prepare('UPDATE conversation_run_states SET unread = 0, updated_at = ? WHERE namespace = ? AND conversation_id = ?').run(Date.now(), namespace, conversationId)
  }

  appendMessage(namespace: string, conversationId: string, message: ConversationMessage, messageId = randomUUID()) {
    const updated = this.db.transaction(() => {
      const result = this.db.prepare(`
        INSERT INTO conversation_messages(namespace, conversation_id, message_id, role, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(namespace, conversationId, messageId, message.role, message.text, message.createdAt)
      if (result.changes !== 1) throw new Error('消息保存失败')
      this.db.prepare(`
        UPDATE conversations SET updated_at = ?, archived = 0
        WHERE namespace = ? AND conversation_id = ?
      `).run(message.createdAt, namespace, conversationId)
    })
    updated()
  }

  listMessages(namespace: string, conversationId: string): ConversationMessage[] {
    const rows = this.db.prepare(`
      SELECT role, text, created_at FROM conversation_messages
      WHERE namespace = ? AND conversation_id = ?
      ORDER BY created_at ASC, message_id ASC
    `).all(namespace, conversationId) as Array<{ role: 'user' | 'assistant'; text: string; created_at: string }>
    return rows.map((row) => ({ role: row.role, text: row.text, createdAt: row.created_at }))
  }

  createTurn(namespace: string, conversationId: string, input: {
    id?: string
    userMessage: { text: string; createdAt?: string }
    attachments?: Attachment[]
    activity?: TurnActivity | null
    assistantMessage?: { text: string; createdAt?: string } | null
    citations?: Citation[]
    artifacts?: ArtifactReference[]
    runtimeConfig?: Partial<TurnRuntimeConfig>
    status?: TurnStatus
    createdAt?: string
    updatedAt?: string
  }): ConversationTurn {
    const id = input.id ?? `turn-${randomUUID()}`
    const createdAt = input.createdAt ?? input.userMessage.createdAt ?? new Date().toISOString()
    const updatedAt = input.updatedAt ?? createdAt
    const userMessage = { text: input.userMessage.text, createdAt: input.userMessage.createdAt ?? createdAt }
    const assistantMessage = input.assistantMessage === undefined || input.assistantMessage === null
      ? null
      : { text: input.assistantMessage.text, createdAt: input.assistantMessage.createdAt ?? updatedAt }
    const runtimeConfig = { ...defaultRuntimeConfig(), ...(input.runtimeConfig ?? {}) }
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO conversation_turns(namespace, conversation_id, turn_id, user_message, attachments, activity, assistant_message, citations, artifacts, runtime_config, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(namespace, conversationId, id, JSON.stringify(userMessage), JSON.stringify(input.attachments ?? []), input.activity == null ? null : JSON.stringify(input.activity), assistantMessage == null ? null : JSON.stringify(assistantMessage), JSON.stringify(input.citations ?? []), JSON.stringify(input.artifacts ?? []), JSON.stringify(runtimeConfig), input.status ?? (assistantMessage ? 'completed' : 'working'), createdAt, updatedAt)
      this.db.prepare('UPDATE conversations SET updated_at = ?, archived = 0 WHERE namespace = ? AND conversation_id = ?').run(updatedAt, namespace, conversationId)
    })()
    return this.getTurn(namespace, id) as ConversationTurn
  }

  getTurn(namespace: string, turnId: string): ConversationTurn | null {
    const row = this.db.prepare('SELECT * FROM conversation_turns WHERE namespace = ? AND turn_id = ?').get(namespace, turnId) as TurnRow | undefined
    return row ? this.mapTurn(row) : null
  }

  listTurns(namespace: string, conversationId: string): ConversationTurn[] {
    const rows = this.db.prepare('SELECT * FROM conversation_turns WHERE namespace = ? AND conversation_id = ? ORDER BY created_at ASC, turn_id ASC').all(namespace, conversationId) as TurnRow[]
    return rows.map((row) => this.mapTurn(row))
  }

  /**
   * 末轮的运行配置与状态。会话概览只需要这两项，走 listTurns 会把整段历史
   * 连同 activity/events 一起反序列化，列表页上是按会话数放大的浪费。
   * 排序与 listTurns 保持一致（created_at, turn_id），取反向第一条。
   */
  latestTurnRuntime(namespace: string, conversationId: string): { runtimeConfig: TurnRuntimeConfig; status: TurnStatus } | null {
    const row = this.db.prepare('SELECT runtime_config, status FROM conversation_turns WHERE namespace = ? AND conversation_id = ? ORDER BY created_at DESC, turn_id DESC LIMIT 1').get(namespace, conversationId) as { runtime_config: string; status: TurnStatus } | undefined
    if (!row) return null
    return { runtimeConfig: { ...defaultRuntimeConfig(), ...normalizeRuntimeConfig(parseJson<Partial<TurnRuntimeConfig>>(row.runtime_config, {})) }, status: row.status }
  }

  /**
   * 高频路径：运行中每条事件都要写一次整轮 activity。调用方手上已经有这一轮时用 known 传进来，
   * 省掉一次整份反序列化；返回值直接由 next 归一化得出，再省一次读回。
   */
  updateTurn(namespace: string, turnId: string, patch: TurnPatch, known?: ConversationTurn | null): ConversationTurn | null {
    const existing = known && known.id === turnId ? known : this.getTurn(namespace, turnId)
    if (!existing) return null
    const next: ConversationTurn = {
      ...existing,
      ...patch,
      userMessage: patch.userMessage ?? existing.userMessage,
      attachments: patch.attachments ?? existing.attachments,
      activity: patch.activity === undefined ? existing.activity : patch.activity,
      assistantMessage: patch.assistantMessage === undefined ? existing.assistantMessage : patch.assistantMessage,
      citations: patch.citations ?? existing.citations,
      artifacts: patch.artifacts ?? existing.artifacts,
      runtimeConfig: patch.runtimeConfig ? { ...existing.runtimeConfig, ...patch.runtimeConfig } : existing.runtimeConfig,
      updatedAt: new Date().toISOString()
    }
    this.db.prepare(`
      UPDATE conversation_turns SET user_message = ?, attachments = ?, activity = ?, assistant_message = ?, citations = ?, artifacts = ?, runtime_config = ?, status = ?, updated_at = ?
      WHERE namespace = ? AND turn_id = ?
    `).run(JSON.stringify(next.userMessage), JSON.stringify(next.attachments), next.activity == null ? null : JSON.stringify(next.activity), next.assistantMessage == null ? null : JSON.stringify(next.assistantMessage), JSON.stringify(next.citations), JSON.stringify(next.artifacts), JSON.stringify(next.runtimeConfig), next.status, next.updatedAt, namespace, turnId)
    this.db.prepare('UPDATE conversations SET updated_at = ?, archived = 0 WHERE namespace = ? AND conversation_id = ?').run(next.updatedAt, namespace, existing.conversationId)
    // 与 mapTurn 读回的结果一致：写进去的就是 next，只差 activity 的状态归一化这一步。
    return { ...next, activity: normalizeTurnActivity(next.activity ?? null, next.status) }
  }

  deleteTurn(namespace: string, turnId: string): ConversationTurn | null {
    const turn = this.getTurn(namespace, turnId)
    if (!turn) return null
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM conversation_turns WHERE namespace = ? AND turn_id = ?').run(namespace, turnId)
      const latest = this.db.prepare('SELECT MAX(updated_at) AS updated_at FROM conversation_turns WHERE namespace = ? AND conversation_id = ?').get(namespace, turn.conversationId) as { updated_at: string | null }
      if (latest.updated_at) this.db.prepare('UPDATE conversations SET updated_at = ? WHERE namespace = ? AND conversation_id = ?').run(latest.updated_at, namespace, turn.conversationId)
    })()
    return turn
  }

  restoreTurn(namespace: string, turn: ConversationTurn): ConversationTurn {
    return this.createTurn(namespace, turn.conversationId, turn)
  }

  private mapTurn(row: TurnRow): ConversationTurn {
    return {
      id: row.turn_id,
      conversationId: row.conversation_id,
      userMessage: parseJson(row.user_message, { text: '', createdAt: row.created_at }),
      attachments: parseJson<Attachment[]>(row.attachments, []),
      activity: normalizeTurnActivity(parseJson<TurnActivity | null>(row.activity, null), row.status),
      assistantMessage: parseJson<ConversationTurn['assistantMessage']>(row.assistant_message, null),
      citations: parseJson<Citation[]>(row.citations, []),
      artifacts: parseJson<ArtifactReference[]>(row.artifacts, []),
      runtimeConfig: { ...defaultRuntimeConfig(), ...normalizeRuntimeConfig(parseJson<Partial<TurnRuntimeConfig>>(row.runtime_config, {})) },
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /** 重命名只动标题，不碰 updated_at：改个名字不该把会话顶到列表最前。 */
  renameConversation(namespace: string, id: string, title: string): ConversationRecord | null {
    const trimmed = title.trim()
    if (!trimmed) throw new Error('会话标题不能为空')
    this.db.prepare('UPDATE conversations SET title = ? WHERE namespace = ? AND conversation_id = ?').run(trimmed, namespace, id)
    return this.getConversation(namespace, id)
  }

  archiveConversation(namespace: string, id: string) {
    this.db.prepare('UPDATE conversations SET archived = 1 WHERE namespace = ? AND conversation_id = ?').run(namespace, id)
  }

  removeConversation(namespace: string, id: string) {
    this.db.prepare('DELETE FROM conversations WHERE namespace = ? AND conversation_id = ?').run(namespace, id)
  }

  /** 清空会话的全部消息、运行时与上下文状态，保留会话条目本身并重置标题；返回被删除的轮次数。 */
  clearConversationTurns(namespace: string, conversationId: string): number {
    return this.db.transaction(() => {
      const { count } = this.db.prepare('SELECT COUNT(*) AS count FROM conversation_turns WHERE namespace = ? AND conversation_id = ?').get(namespace, conversationId) as { count: number }
      this.modelUsageRepository.deleteConversation(namespace, conversationId)
      this.db.prepare('DELETE FROM conversation_turns WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      // 这些表不随 turn 外键级联，且轮次清空后模型运行时、压缩记录等一并失效。
      this.db.prepare('DELETE FROM conversation_messages WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM tool_calls WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM session_todos WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM conversation_summaries WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM conversation_compactions WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM conversation_context_state WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM conversation_model_runtime WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE namespace = ? AND conversation_id = ?').run('新对话', new Date().toISOString(), namespace, conversationId)
      return count
    })()
  }

  listProjectsPage(namespace: string, query: PageQuery = {}, archived = false): PageResult<ProjectRecord> {
    const pageSize = normalizePageSize(query.pageSize)
    const keyword = query.keyword?.trim() || null
    const { count } = this.db.prepare(`SELECT COUNT(*) AS count FROM projects WHERE namespace = ? AND archived = ? AND (? IS NULL OR name LIKE '%' || ? || '%' OR path LIKE '%' || ? || '%')`).get(namespace, archived ? 1 : 0, keyword, keyword, keyword) as { count: number }
    const page = resolvePage(query.page, count, pageSize)
    const rows = this.db.prepare(`SELECT project_id, name, path, color, archived, created_at, updated_at FROM projects WHERE namespace = ? AND archived = ? AND (? IS NULL OR name LIKE '%' || ? || '%' OR path LIKE '%' || ? || '%') ORDER BY updated_at DESC, project_id DESC LIMIT ? OFFSET ?`).all(namespace, archived ? 1 : 0, keyword, keyword, keyword, pageSize, pageOffset(page, pageSize)) as Array<{ project_id: string; name: string; path: string; color: string; archived: number; created_at: string; updated_at: string }>
    const items = rows.map((row) => ({ id: row.project_id, name: row.name, path: row.path, color: row.color, archived: Boolean(row.archived), createdAt: row.created_at, updatedAt: row.updated_at }))
    return { items, total: count, page, pageSize }
  }

  listProjects(namespace: string, archived = false): ProjectRecord[] {
    const rows = this.db.prepare(`
      SELECT project_id, name, path, color, archived, created_at, updated_at
      FROM projects WHERE namespace = ? AND archived = ?
      ORDER BY updated_at DESC, project_id DESC
    `).all(namespace, archived ? 1 : 0) as Array<{ project_id: string; name: string; path: string; color: string; archived: number; created_at: string; updated_at: string }>
    return rows.map((row) => ({ id: row.project_id, name: row.name, path: row.path, color: row.color, archived: Boolean(row.archived), createdAt: row.created_at, updatedAt: row.updated_at }))
  }

  getProjectByPath(namespace: string, path: string): ProjectRecord | null {
    const row = this.db.prepare(`
      SELECT project_id, name, path, color, archived, created_at, updated_at
      FROM projects WHERE namespace = ? AND path = ?
    `).get(namespace, path) as { project_id: string; name: string; path: string; color: string; archived: number; created_at: string; updated_at: string } | undefined
    return row ? { id: row.project_id, name: row.name, path: row.path, color: row.color, archived: Boolean(row.archived), createdAt: row.created_at, updatedAt: row.updated_at } : null
  }

  upsertProject(namespace: string, input: { id: string; name: string; path: string; color: string; createdAt?: string }): ProjectRecord {
    const now = input.createdAt ?? new Date().toISOString()
    // path 上的唯一索引保证同一目录只有一条，重复添加只刷新名称并解除归档。
    this.db.prepare(`
      INSERT INTO projects(namespace, project_id, name, path, color, archived, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(namespace, path) DO UPDATE SET name = excluded.name, archived = 0, updated_at = excluded.updated_at
    `).run(namespace, input.id, input.name, input.path, input.color, now, now)
    return this.getProjectByPath(namespace, input.path) as ProjectRecord
  }

  archiveProject(namespace: string, id: string) {
    this.db.prepare('UPDATE projects SET archived = 1 WHERE namespace = ? AND project_id = ?').run(namespace, id)
  }

  removeProject(namespace: string, id: string) {
    this.db.prepare('DELETE FROM projects WHERE namespace = ? AND project_id = ?').run(namespace, id)
  }

  listArtifacts(namespace: string, query: ArtifactQuery = {}): Artifact[] {
    const keyword = (query.keyword ?? '').trim()
    const rows = this.db.prepare(`
      SELECT artifact_id, workspace_id, conversation_id, task_id, agent_run_id, turn_id, name, type, path, content, size, source, created_at, updated_at
      FROM artifacts
      WHERE namespace = ?
        AND (? IS NULL OR workspace_id = ?)
        AND (? IS NULL OR conversation_id = ?)
        AND (? = '' OR name LIKE ? OR path LIKE ? OR type LIKE ?)
      ORDER BY updated_at DESC, artifact_id DESC
      LIMIT ?
    `).all(
      namespace,
      query.workspaceId ?? null, query.workspaceId ?? null,
      query.conversationId ?? null, query.conversationId ?? null,
      keyword, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`,
      Math.min(Math.max(query.limit ?? 500, 1), 1000)
    ) as Array<{
      artifact_id: string; workspace_id: string; conversation_id: string | null; task_id: string | null
      agent_run_id: string | null; turn_id: string | null; name: string; type: Artifact['type']
      path: string | null; content: string | null; size: number | null; source: string | null
      created_at: number; updated_at: number
    }>
    return rows.map((row) => ({
      id: row.artifact_id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id ?? undefined,
      taskId: row.task_id ?? undefined,
      agentRunId: row.agent_run_id ?? undefined,
      turnId: row.turn_id ?? undefined,
      name: row.name,
      type: row.type,
      path: row.path ?? undefined,
      content: row.content ?? undefined,
      size: row.size ?? undefined,
      source: row.source ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  /** 同一工作区 + 路径 + 会话的写入视为更新：刷新时间戳与内容，不重复登记。 */
  upsertArtifact(namespace: string, input: {
    id: string
    workspaceId: string
    conversationId?: string
    taskId?: string
    agentRunId?: string
    turnId?: string
    name: string
    type: Artifact['type']
    path?: string
    content?: string
    size?: number
    source?: string
    createdAt?: number
  }): Artifact {
    const now = Date.now()
    const existing = this.db.prepare(`
      SELECT artifact_id FROM artifacts
      WHERE namespace = ? AND workspace_id = ? AND path IS ? AND conversation_id IS ?
      LIMIT 1
    `).get(namespace, input.workspaceId, input.path ?? null, input.conversationId ?? null) as { artifact_id: string } | undefined
    const artifactId = existing?.artifact_id ?? input.id
    const createdAt = existing ? this.db.prepare('SELECT created_at FROM artifacts WHERE namespace = ? AND artifact_id = ?').get(namespace, artifactId) as { created_at: number } | undefined : undefined
    this.db.prepare(`
      INSERT INTO artifacts(namespace, artifact_id, workspace_id, conversation_id, task_id, agent_run_id, turn_id, name, type, path, content, size, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, artifact_id) DO UPDATE SET
        name = excluded.name, type = excluded.type, path = excluded.path,
        content = excluded.content, size = excluded.size, source = excluded.source,
        turn_id = excluded.turn_id, agent_run_id = excluded.agent_run_id,
        updated_at = excluded.updated_at
    `).run(
      namespace, artifactId, input.workspaceId, input.conversationId ?? null, input.taskId ?? null,
      input.agentRunId ?? null, input.turnId ?? null, input.name, input.type, input.path ?? null,
      input.content ?? null, input.size ?? null, input.source ?? null,
      createdAt?.created_at ?? input.createdAt ?? now, now
    )
    return this.listArtifacts(namespace, { workspaceId: input.workspaceId, limit: 1000 }).find((item) => item.id === artifactId) as Artifact
  }

  removeArtifact(namespace: string, id: string) {
    this.db.prepare('DELETE FROM artifacts WHERE namespace = ? AND artifact_id = ?').run(namespace, id)
  }

  /**
   * 记录 Agent 对某个文件的最终变更状态。一轮内同一路径只有一条，重复写入直接覆盖：
   * 调用方每次都拿「本轮基线 vs 当前」重算，写进来的就是整轮累计结果，不能再叠加。
   * diff 文本单独存这张表，不进 conversation_turns.activity——那份每次读会话都要整体反序列化。
   */
  upsertFileChange(namespace: string, input: {
    turnId: string
    conversationId: string
    runId: string
    path: string
    operation: FileOperation
    oldPath?: string | null
    additions: number
    deletions: number
    tools: string[]
    beforeHash?: string | null
    afterHash?: string | null
    diff?: string | null
  }) {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO agent_file_changes(namespace, turn_id, path, conversation_id, run_id, operation, old_path, additions, deletions, tools, before_hash, after_hash, diff, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, turn_id, path) DO UPDATE SET
        operation = excluded.operation,
        old_path = COALESCE(excluded.old_path, old_path),
        additions = excluded.additions,
        deletions = excluded.deletions,
        tools = excluded.tools,
        after_hash = excluded.after_hash,
        diff = excluded.diff,
        updated_at = excluded.updated_at
    `).run(
      namespace, input.turnId, input.path, input.conversationId, input.runId, input.operation,
      input.oldPath ?? null, input.additions, input.deletions, JSON.stringify(input.tools),
      input.beforeHash ?? null, input.afterHash ?? null, input.diff ?? null, now, now
    )
  }

  /** 撤销后归零的文件（新建又删掉）不该留在本轮变更里。 */
  removeFileChange(namespace: string, turnId: string, path: string) {
    this.db.prepare('DELETE FROM agent_file_changes WHERE namespace = ? AND turn_id = ? AND path = ?').run(namespace, turnId, path)
  }

  /** 单条变更的原始记录，供合并规则读取上一次状态。 */
  getFileChange(namespace: string, turnId: string, path: string): { operation: FileOperation; tools: string[]; beforeHash: string | null } | null {
    const row = this.db.prepare('SELECT operation, tools, before_hash FROM agent_file_changes WHERE namespace = ? AND turn_id = ? AND path = ?')
      .get(namespace, turnId, path) as { operation: FileOperation; tools: string; before_hash: string | null } | undefined
    if (!row) return null
    return { operation: row.operation, tools: parseJson<string[]>(row.tools, []), beforeHash: row.before_hash }
  }

  /** 一轮的变更聚合，Bar 直接用；diff 文本不在这里返回，按需走 getFileChangeDiff。 */
  listFileChanges(namespace: string, turnId: string): AgentRunChanges {
    const rows = this.db.prepare(`
      SELECT path, operation, old_path, additions, deletions, tools, diff, updated_at
      FROM agent_file_changes WHERE namespace = ? AND turn_id = ?
      ORDER BY updated_at DESC, path ASC
    `).all(namespace, turnId) as Array<{
      path: string; operation: FileOperation; old_path: string | null
      additions: number; deletions: number; tools: string; diff: string | null; updated_at: number
    }>
    const files: AgentFileChange[] = rows.map((row) => ({
      path: row.path,
      operation: row.operation,
      oldPath: row.old_path ?? undefined,
      additions: row.additions,
      deletions: row.deletions,
      tools: parseJson<string[]>(row.tools, []),
      hasDiff: Boolean(row.diff),
      updatedAt: row.updated_at
    }))
    return {
      turnId,
      changedFiles: files.length,
      addedFiles: files.filter((file) => file.operation === 'create').length,
      modifiedFiles: files.filter((file) => file.operation === 'update').length,
      deletedFiles: files.filter((file) => file.operation === 'delete').length,
      renamedFiles: files.filter((file) => file.operation === 'rename').length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      files
    }
  }

  getFileChangeDiff(namespace: string, turnId: string, path: string): string | null {
    const row = this.db.prepare('SELECT diff FROM agent_file_changes WHERE namespace = ? AND turn_id = ? AND path = ?')
      .get(namespace, turnId, path) as { diff: string | null } | undefined
    return row?.diff ?? null
  }

  /**
   * Agent 运行台账。turn.activity 里已经有事件流，但那份是整段 JSON，跨会话统计要全表反序列化；
   * 这两张表存的是可直接查询的结构化状态，并且是重启后收敛「卡在 running」的唯一依据。
   */
  startAgentRun(namespace: string, input: { runId: string; conversationId: string; turnId: string; mode: ConversationMode; startedAt?: number }) {
    this.db.prepare(`
      INSERT INTO agent_runs(namespace, run_id, conversation_id, turn_id, mode, status, started_at, finished_at, error, error_kind, retry_count)
      VALUES (?, ?, ?, ?, ?, 'running', ?, NULL, NULL, NULL, 0)
      ON CONFLICT(namespace, run_id) DO UPDATE SET
        status = 'running', started_at = excluded.started_at, finished_at = NULL, error = NULL, error_kind = NULL, retry_count = 0
    `).run(namespace, input.runId, input.conversationId, input.turnId, input.mode, input.startedAt ?? Date.now())
  }

  /** 终态只认第一次：run_phase cleanup 之后还会有 contextUpdated 等事件，重复收尾不能覆盖真实结局。 */
  finishAgentRun(namespace: string, runId: string, status: Exclude<AgentRunStatus, 'running'>, error?: string | null, finishedAt?: number, errorKind?: RunErrorKind | null) {
    this.db.prepare(`
      UPDATE agent_runs SET status = ?, finished_at = ?, error = ?, error_kind = ?
      WHERE namespace = ? AND run_id = ? AND status = 'running'
    `).run(status, finishedAt ?? Date.now(), error ?? null, errorKind ?? null, namespace, runId)
  }

  /** 自动重试计数。运行中才累加：终态之后再来的重试事件不该改写已结算的记录。 */
  bumpAgentRunRetry(namespace: string, runId: string): number {
    this.db.prepare(`
      UPDATE agent_runs SET retry_count = retry_count + 1
      WHERE namespace = ? AND run_id = ? AND status = 'running'
    `).run(namespace, runId)
    const row = this.db.prepare('SELECT retry_count FROM agent_runs WHERE namespace = ? AND run_id = ?').get(namespace, runId) as { retry_count: number } | undefined
    return row?.retry_count ?? 0
  }

  startAgentTask(namespace: string, input: {
    taskId: string
    runId: string
    conversationId: string
    turnId: string
    parentToolCallId?: string | null
    subAgentRunId?: string | null
    agentId: string
    agentName: string
    goal: string
    startedAt?: number
  }) {
    this.db.prepare(`
      INSERT INTO agent_tasks(namespace, task_id, run_id, conversation_id, turn_id, parent_tool_call_id, sub_agent_run_id,
        agent_id, agent_name, goal, status, summary, error, started_at, finished_at, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, NULL, ?, NULL, NULL)
      ON CONFLICT(namespace, task_id) DO UPDATE SET
        status = 'running', started_at = excluded.started_at, finished_at = NULL, duration_ms = NULL, error = NULL
    `).run(
      namespace, input.taskId, input.runId, input.conversationId, input.turnId,
      input.parentToolCallId ?? null, input.subAgentRunId ?? null,
      input.agentId, input.agentName, input.goal, input.startedAt ?? Date.now()
    )
  }

  finishAgentTask(namespace: string, taskId: string, patch: {
    status: Exclude<AgentTaskStatus, 'queued' | 'running'>
    summary?: string | null
    error?: string | null
    finishedAt?: number
  }) {
    const finishedAt = patch.finishedAt ?? Date.now()
    this.db.prepare(`
      UPDATE agent_tasks SET
        status = ?, summary = ?, error = ?, finished_at = ?, duration_ms = ? - started_at
      WHERE namespace = ? AND task_id = ? AND status IN ('queued', 'running')
    `).run(patch.status, patch.summary ?? null, patch.error ?? null, finishedAt, finishedAt, namespace, taskId)
  }

  listAgentTasks(namespace: string, query: { runId?: string; conversationId?: string; turnId?: string; limit?: number } = {}): AgentTaskRecord[] {
    const conditions = ['namespace = ?']
    const params: unknown[] = [namespace]
    for (const [column, value] of [['run_id', query.runId], ['conversation_id', query.conversationId], ['turn_id', query.turnId]] as const) {
      if (!value) continue
      conditions.push(`${column} = ?`)
      params.push(value)
    }
    const rows = this.db.prepare(`
      SELECT task_id, run_id, conversation_id, turn_id, parent_tool_call_id, sub_agent_run_id, agent_id, agent_name,
             goal, status, summary, error, started_at, finished_at, duration_ms
      FROM agent_tasks WHERE ${conditions.join(' AND ')}
      ORDER BY started_at ASC, task_id ASC LIMIT ?
    `).all(...params, Math.min(Math.max(query.limit ?? 200, 1), 500)) as AgentTaskRow[]
    return rows.map(mapAgentTask)
  }

  /** 会话详情用：一次取运行与任务两张表，按 runId 归并，避免逐个运行再查一次任务。 */
  listAgentRunLedger(namespace: string, conversationId: string, limit = 20): AgentRunLedgerEntry[] {
    const runs = this.db.prepare(`
      SELECT run_id, conversation_id, turn_id, mode, status, started_at, finished_at, error, error_kind, retry_count
      FROM agent_runs WHERE namespace = ? AND conversation_id = ?
      ORDER BY started_at DESC, run_id DESC LIMIT ?
    `).all(namespace, conversationId, Math.min(Math.max(limit, 1), 100)) as AgentRunRow[]
    if (!runs.length) return []
    const placeholders = runs.map(() => '?').join(', ')
    const tasks = this.db.prepare(`
      SELECT task_id, run_id, conversation_id, turn_id, parent_tool_call_id, sub_agent_run_id, agent_id, agent_name,
             goal, status, summary, error, started_at, finished_at, duration_ms
      FROM agent_tasks WHERE namespace = ? AND run_id IN (${placeholders})
      ORDER BY started_at ASC, task_id ASC
    `).all(namespace, ...runs.map((run) => run.run_id)) as AgentTaskRow[]
    const byRun = new Map<string, AgentTaskRecord[]>()
    for (const row of tasks) {
      const list = byRun.get(row.run_id) ?? []
      list.push(mapAgentTask(row))
      byRun.set(row.run_id, list)
    }
    return runs.map((row) => ({ run: mapAgentRun(row), tasks: byRun.get(row.run_id) ?? [] }))
  }

  /**
   * 进程异常退出后，上一轮的 run/task 会永远停在 running。启动时收敛成 interrupted / cancelled，
   * 否则界面上的「执行中」永远转下去。activeRunIds 是当前进程真正在跑的运行，必须排除。
   *
   * 回合必须一起收敛：界面判定 spinner 与 streaming 看的是 conversation_turns.status 与
   * activity.status（MessageList、AssistantMessage），只改台账的话转圈永远不停。
   * 受影响的回合由这批 run 的 turn_id 圈定，是有界集合，不是全表扫描。
   */
  markInterruptedAgentRuns(namespace: string, activeRunIds: readonly string[] = []): number {
    const exclusion = activeRunIds.length ? ` AND run_id NOT IN (${activeRunIds.map(() => '?').join(', ')})` : ''
    const now = Date.now()
    const reconcile = this.db.transaction(() => {
      // 先取 turn_id：update 之后这些行就不再是 running，圈不出来了
      const orphanTurnIds = (this.db.prepare(`SELECT DISTINCT turn_id FROM agent_runs WHERE namespace = ? AND status = 'running'${exclusion}`)
        .all(namespace, ...activeRunIds) as Array<{ turn_id: string }>).map((row) => row.turn_id)
      const runs = this.db.prepare(`UPDATE agent_runs SET status = 'interrupted', finished_at = ?, error = COALESCE(error, '任务已中断') WHERE namespace = ? AND status = 'running'${exclusion}`)
        .run(now, namespace, ...activeRunIds)
      this.db.prepare(`UPDATE agent_tasks SET status = 'cancelled', finished_at = ?, duration_ms = ? - started_at WHERE namespace = ? AND status IN ('queued', 'running')${exclusion}`)
        .run(now, now, namespace, ...activeRunIds)
      this.settleOrphanTurns(namespace, orphanTurnIds, now)
      return runs.changes
    })
    return reconcile()
  }

  getAgentRun(namespace: string, runId: string): AgentRunRecord | null {
    const row = this.db.prepare(`
      SELECT run_id, conversation_id, turn_id, mode, status, started_at, finished_at, error, error_kind, retry_count
      FROM agent_runs WHERE namespace = ? AND run_id = ?
    `).get(namespace, runId) as AgentRunRow | undefined
    return row ? mapAgentRun(row) : null
  }

  /**
   * 会话最近一次可续跑的中断运行。只看最后一条运行：中间某次中断之后用户又发过新消息的，
   * 上下文早已往前走，再回头续跑只会制造重复劳动。
   *
   * 只取计数，不读 activity：会话打开时就要问一次，走 listTurns 会把整段历史反序列化。
   */
  findResumableRun(namespace: string, conversationId: string): ResumableRun | null {
    const run = this.db.prepare(`
      SELECT run_id, turn_id, status, error, error_kind, finished_at
      FROM agent_runs WHERE namespace = ? AND conversation_id = ?
      ORDER BY started_at DESC, run_id DESC LIMIT 1
    `).get(namespace, conversationId) as { run_id: string; turn_id: string; status: AgentRunStatus; error: string | null; error_kind: RunErrorKind | null; finished_at: number | null } | undefined
    if (!run || run.status !== 'interrupted') return null

    const turn = this.db.prepare('SELECT user_message FROM conversation_turns WHERE namespace = ? AND turn_id = ?')
      .get(namespace, run.turn_id) as { user_message: string } | undefined
    if (!turn) return null

    const pendingTodos = (this.db.prepare(`
      SELECT COUNT(*) AS total FROM session_todos
      WHERE namespace = ? AND conversation_id = ? AND status NOT IN ('completed', 'cancelled', 'skipped')
    `).get(namespace, conversationId) as { total: number }).total
    const changedFiles = (this.db.prepare('SELECT COUNT(*) AS total FROM agent_file_changes WHERE namespace = ? AND turn_id = ?')
      .get(namespace, run.turn_id) as { total: number }).total

    return {
      runId: run.run_id,
      conversationId,
      turnId: run.turn_id,
      goal: parseJson<{ text?: string }>(turn.user_message, {}).text ?? '',
      reason: run.error,
      errorKind: run.error_kind ?? null,
      pendingTodos,
      changedFiles,
      interruptedAt: run.finished_at ?? 0
    }
  }

  /** 把中断运行留下的 working 回合结算掉；已有终态的回合不动。 */
  private settleOrphanTurns(namespace: string, turnIds: readonly string[], now: number) {
    if (!turnIds.length) return
    const finishedAt = new Date(now).toISOString()
    const select = this.db.prepare("SELECT activity FROM conversation_turns WHERE namespace = ? AND turn_id = ? AND status = 'working'")
    const update = this.db.prepare("UPDATE conversation_turns SET status = 'interrupted', activity = ?, updated_at = ? WHERE namespace = ? AND turn_id = ? AND status = 'working'")
    for (const turnId of turnIds) {
      const row = select.get(namespace, turnId) as { activity: string | null } | undefined
      if (!row) continue
      const activity = parseJson<TurnActivity | null>(row.activity, null)
      // activity 缺失或损坏时只改 status：execution 快照在读取侧由 normalizeTurnActivity 按 turn.status 归一
      const nextActivity = activity ? JSON.stringify({ ...activity, status: 'interrupted', finishedAt: activity.finishedAt ?? finishedAt }) : row.activity
      update.run(nextActivity, finishedAt, namespace, turnId)
    }
  }

  /**
   * 管理界面的记忆列表。默认只列 active：superseded 是被替代的历史版本，deleted 是用户软删，
   * 两者留在库里供追溯，但不该出现在默认视图里。
   */
  listMemories(namespace: string, query: MemoryListQuery = {}): PageResult<MemoryRecord> {
    const conditions = ['namespace = ?']
    const params: unknown[] = [namespace]
    conditions.push('status = ?')
    params.push(query.status ?? 'active')
    if (query.scope) {
      conditions.push('scope = ?')
      params.push(query.scope)
    }
    if (query.scopeId !== undefined) {
      if (query.scopeId === null) conditions.push('scope_id IS NULL')
      else {
        conditions.push('scope_id = ?')
        params.push(query.scopeId)
      }
    }
    if (query.type) {
      conditions.push('type = ?')
      params.push(query.type)
    }
    const keyword = (query.keyword ?? '').trim()
    if (keyword) {
      conditions.push('content LIKE ?')
      params.push(`%${keyword}%`)
    }
    const where = conditions.join(' AND ')
    const pageSize = normalizePageSize(query.pageSize)
    const { count } = this.db.prepare(`SELECT COUNT(*) AS count FROM memories WHERE ${where}`).get(...params) as { count: number }
    const page = resolvePage(query.page, count, pageSize)
    const rows = this.db.prepare(`
      SELECT memory_id, scope, scope_id, type, content, importance, confidence, source_conversation_id,
             source_turn_id, source_run_id, status, superseded_by, created_at, updated_at, last_accessed_at, expires_at
      FROM memories WHERE ${where}
      ORDER BY updated_at DESC, memory_id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, pageOffset(page, pageSize)) as MemoryRow[]
    return { items: rows.map(mapMemory), total: count, page, pageSize }
  }

  countMemories(namespace: string, scope?: MemoryScope, scopeId?: string | null): number {
    if (!scope) {
      const { count } = this.db.prepare("SELECT COUNT(*) AS count FROM memories WHERE namespace = ? AND status = 'active'").get(namespace) as { count: number }
      return count
    }
    const { count } = this.db.prepare(`
      SELECT COUNT(*) AS count FROM memories
      WHERE namespace = ? AND status = 'active' AND scope = ? AND scope_id IS ?
    `).get(namespace, scope, scopeId ?? null) as { count: number }
    return count
  }

  /** 召回与抽取共用的作用域条件：当前项目 + 全局 +（可选）指定 Sub-agent。 */
  private scopeClause(workspaceId: string | null, agentId: string | null | undefined, params: unknown[]): string {
    const branches = ["scope = 'global'"]
    if (workspaceId) {
      branches.push("(scope = 'workspace' AND scope_id = ?)")
      params.push(workspaceId)
    }
    if (agentId) {
      branches.push("(scope = 'agent' AND scope_id = ?)")
      params.push(agentId)
    }
    return `(${branches.join(' OR ')})`
  }

  /**
   * FTS 检索，返回按相关度排序的记忆。
   * 短词（uv、go）在 trigram 索引里没有对应 token，只能走 LIKE 兜底，拼在 FTS 结果之后。
   */
  searchMemories(namespace: string, input: {
    match: string | null
    likeTerms?: readonly string[]
    workspaceId: string | null
    agentId?: string | null
    limit?: number
    now?: number
  }): MemoryRecord[] {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)
    const now = input.now ?? Date.now()
    const columns = `memories.memory_id, memories.scope, memories.scope_id, memories.type, memories.content,
      memories.importance, memories.confidence, memories.source_conversation_id, memories.source_turn_id,
      memories.source_run_id, memories.status, memories.superseded_by, memories.created_at, memories.updated_at,
      memories.last_accessed_at, memories.expires_at`
    const results: MemoryRecord[] = []
    const seen = new Set<string>()
    if (input.match) {
      const params: unknown[] = [input.match, namespace, now]
      const scope = this.scopeClause(input.workspaceId, input.agentId, params)
      const rows = this.db.prepare(`
        SELECT ${columns}
        FROM memories_fts JOIN memories ON memories.rowid = memories_fts.rowid
        WHERE memories_fts MATCH ?
          AND memories.namespace = ? AND memories.status = 'active'
          AND (memories.expires_at IS NULL OR memories.expires_at > ?)
          AND ${scope}
        ORDER BY bm25(memories_fts) ASC, memories.updated_at DESC
        LIMIT ?
      `).all(...params, limit) as MemoryRow[]
      for (const row of rows) {
        if (seen.has(row.memory_id)) continue
        seen.add(row.memory_id)
        results.push(mapMemory(row))
      }
    }
    const likeTerms = (input.likeTerms ?? []).filter((term) => term.trim().length > 0)
    if (likeTerms.length && results.length < limit) {
      const params: unknown[] = [namespace, now]
      const scope = this.scopeClause(input.workspaceId, input.agentId, params)
      const likeClause = likeTerms.map(() => 'content LIKE ?').join(' OR ')
      for (const term of likeTerms) params.push(`%${term}%`)
      const rows = this.db.prepare(`
        SELECT ${columns} FROM memories
        WHERE namespace = ? AND status = 'active'
          AND (expires_at IS NULL OR expires_at > ?)
          AND ${scope} AND (${likeClause})
        ORDER BY importance DESC, updated_at DESC
        LIMIT ?
      `).all(...params, limit - results.length) as MemoryRow[]
      for (const row of rows) {
        if (seen.has(row.memory_id)) continue
        seen.add(row.memory_id)
        results.push(mapMemory(row))
      }
    }
    return results
  }

  /** 抽取时给模型看的既有记忆：按重要性取头部即可，不需要全量。 */
  listActiveMemoriesForScopes(namespace: string, input: { workspaceId: string | null; agentId?: string | null; limit?: number }): MemoryRecord[] {
    const params: unknown[] = [namespace]
    const scope = this.scopeClause(input.workspaceId, input.agentId, params)
    const rows = this.db.prepare(`
      SELECT memory_id, scope, scope_id, type, content, importance, confidence, source_conversation_id,
             source_turn_id, source_run_id, status, superseded_by, created_at, updated_at, last_accessed_at, expires_at
      FROM memories
      WHERE namespace = ? AND status = 'active' AND ${scope}
      ORDER BY importance DESC, updated_at DESC
      LIMIT ?
    `).all(...params, Math.min(Math.max(input.limit ?? 20, 1), 100)) as MemoryRow[]
    return rows.map(mapMemory)
  }

  getMemory(namespace: string, id: string): MemoryRecord | null {
    const row = this.db.prepare(`
      SELECT memory_id, scope, scope_id, type, content, importance, confidence, source_conversation_id,
             source_turn_id, source_run_id, status, superseded_by, created_at, updated_at, last_accessed_at, expires_at
      FROM memories WHERE namespace = ? AND memory_id = ?
    `).get(namespace, id) as MemoryRow | undefined
    return row ? mapMemory(row) : null
  }

  /** 新建记忆。memories 与 memories_fts 必须在同一事务里写，否则检索会漏条或命中已删记录。 */
  createMemory(namespace: string, input: {
    id?: string
    scope: MemoryScope
    scopeId: string | null
    type: MemoryType
    content: string
    importance?: number
    confidence?: number
    sourceConversationId?: string | null
    sourceTurnId?: string | null
    sourceRunId?: string | null
    createdAt?: number
  }): MemoryRecord {
    const now = Date.now()
    const id = input.id ?? randomUUID()
    const write = this.db.transaction(() => {
      const info = this.db.prepare(`
        INSERT INTO memories(namespace, memory_id, scope, scope_id, type, content, importance, confidence,
          source_conversation_id, source_turn_id, source_run_id, status, superseded_by, created_at, updated_at, last_accessed_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, NULL, NULL)
      `).run(
        namespace, id, input.scope, input.scopeId, input.type, input.content,
        Math.min(5, Math.max(1, Math.round(input.importance ?? 3))),
        Math.min(1, Math.max(0, input.confidence ?? 0.8)),
        input.sourceConversationId ?? null, input.sourceTurnId ?? null, input.sourceRunId ?? null,
        input.createdAt ?? now, input.createdAt ?? now
      )
      this.db.prepare('INSERT INTO memories_fts(rowid, content) VALUES (?, ?)').run(info.lastInsertRowid, input.content)
    })
    write()
    return this.getMemory(namespace, id) as MemoryRecord
  }

  updateMemory(namespace: string, id: string, patch: MemoryUpdateInput): MemoryRecord | null {
    const row = this.db.prepare('SELECT rowid FROM memories WHERE namespace = ? AND memory_id = ?').get(namespace, id) as { rowid: number } | undefined
    if (!row) return null
    const write = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE memories SET
          content = COALESCE(?, content),
          type = COALESCE(?, type),
          importance = COALESCE(?, importance),
          status = COALESCE(?, status),
          updated_at = ?
        WHERE namespace = ? AND memory_id = ?
      `).run(
        patch.content ?? null,
        patch.type ?? null,
        patch.importance === undefined ? null : Math.min(5, Math.max(1, Math.round(patch.importance))),
        patch.status ?? null,
        Date.now(), namespace, id
      )
      if (patch.content !== undefined) {
        this.db.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(row.rowid)
        this.db.prepare('INSERT INTO memories_fts(rowid, content) VALUES (?, ?)').run(row.rowid, patch.content)
      }
    })
    write()
    return this.getMemory(namespace, id)
  }

  /** 旧记忆被新记忆推翻：置 superseded 并记下替代者，保留原文供用户追溯。 */
  supersedeMemory(namespace: string, oldId: string, newId: string) {
    this.db.prepare(`
      UPDATE memories SET status = 'superseded', superseded_by = ?, updated_at = ?
      WHERE namespace = ? AND memory_id = ? AND status = 'active'
    `).run(newId, Date.now(), namespace, oldId)
  }

  /** 重复抽取到同一条记忆时只刷新，不新增行。 */
  refreshMemory(namespace: string, id: string, importance: number) {
    this.db.prepare(`
      UPDATE memories SET importance = MAX(importance, ?), updated_at = ? WHERE namespace = ? AND memory_id = ?
    `).run(Math.min(5, Math.max(1, Math.round(importance))), Date.now(), namespace, id)
  }

  /** 召回后批量记一次访问时间；逐条 UPDATE 会把同步 SQLite 写放大到 TopK 次。 */
  touchMemories(namespace: string, ids: readonly string[]) {
    if (!ids.length) return
    const placeholders = ids.map(() => '?').join(', ')
    this.db.prepare(`UPDATE memories SET last_accessed_at = ? WHERE namespace = ? AND memory_id IN (${placeholders})`)
      .run(Date.now(), namespace, ...ids)
  }

  /** 用户删除单条：软删，FTS 行同步移除，避免检索命中已删内容。 */
  removeMemory(namespace: string, id: string) {
    const row = this.db.prepare('SELECT rowid FROM memories WHERE namespace = ? AND memory_id = ?').get(namespace, id) as { rowid: number } | undefined
    if (!row) return
    const write = this.db.transaction(() => {
      this.db.prepare("UPDATE memories SET status = 'deleted', updated_at = ? WHERE namespace = ? AND memory_id = ?").run(Date.now(), namespace, id)
      this.db.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(row.rowid)
    })
    write()
  }

  /** 清空某个作用域：这一步是物理删除，用户在界面上已经确认过。 */
  clearMemories(namespace: string, scope?: MemoryScope, scopeId?: string | null): number {
    const conditions = ['namespace = ?']
    const params: unknown[] = [namespace]
    if (scope) {
      conditions.push('scope = ?')
      params.push(scope)
      conditions.push('scope_id IS ?')
      params.push(scopeId ?? null)
    }
    const where = conditions.join(' AND ')
    const rows = this.db.prepare(`SELECT rowid FROM memories WHERE ${where}`).all(...params) as Array<{ rowid: number }>
    if (!rows.length) return 0
    const write = this.db.transaction(() => {
      const removeFts = this.db.prepare('DELETE FROM memories_fts WHERE rowid = ?')
      for (const row of rows) removeFts.run(row.rowid)
      this.db.prepare(`DELETE FROM memories WHERE ${where}`).run(...params)
    })
    write()
    return rows.length
  }

  /** 模型是会话级绑定：打开历史会话要还原成上次用的模型，而不是跟着应用当前选择走。 */
  getConversationModelId(namespace: string, id: string): number | null {
    const row = this.db.prepare('SELECT model_id FROM conversations WHERE namespace = ? AND conversation_id = ?').get(namespace, id) as { model_id: number | null } | undefined
    return row?.model_id ?? null
  }

  setConversationModelId(namespace: string, id: string, modelId: number | null) {
    this.db.prepare('UPDATE conversations SET model_id = ? WHERE namespace = ? AND conversation_id = ?').run(modelId, namespace, id)
  }

  getConversationSessionFile(namespace: string, id: string): string | null {
    const row = this.db.prepare('SELECT session_file FROM conversations WHERE namespace = ? AND conversation_id = ?').get(namespace, id) as { session_file: string | null } | undefined
    return row?.session_file ?? null
  }

  setConversationSessionFile(namespace: string, id: string, sessionFile: string) {
    this.db.prepare('UPDATE conversations SET session_file = ? WHERE namespace = ? AND conversation_id = ?').run(sessionFile, namespace, id)
  }

  recordToolCall(namespace: string, input: {
    id: string
    conversationId: string
    turnId: string
    runId: string
    toolName: string
    source?: import('../shared/types').ToolSource | null
    arguments: unknown
    status: ToolCallRecord['status']
    permissionResult?: string
    startedAt?: string
    parentToolCallId?: string
    subAgentId?: string
    subAgentRunId?: string
  }) {
    this.db.prepare(`
      INSERT INTO tool_calls(namespace, id, conversation_id, turn_id, run_id, tool_name, source, arguments_json, status, permission_result, started_at, parent_tool_call_id, sub_agent_id, sub_agent_run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(namespace, input.id, input.conversationId, input.turnId, input.runId, input.toolName, input.source ?? null, JSON.stringify(input.arguments ?? {}), input.status, input.permissionResult ?? null, input.startedAt ?? new Date().toISOString(), input.parentToolCallId ?? null, input.subAgentId ?? null, input.subAgentRunId ?? null)
  }

  updateToolCall(namespace: string, id: string, patch: {
    status?: ToolCallRecord['status']
    result?: unknown
    error?: string | null
    permissionResult?: string | null
    finishedAt?: string
    durationMs?: number
  }) {
    const row = this.db.prepare('SELECT result_json FROM tool_calls WHERE namespace = ? AND id = ?').get(namespace, id) as { result_json: string | null } | undefined
    if (!row) return
    this.db.prepare(`
      UPDATE tool_calls SET
        status = COALESCE(?, status),
        result_json = ?,
        error = ?,
        permission_result = COALESCE(?, permission_result),
        finished_at = COALESCE(?, finished_at),
        duration_ms = COALESCE(?, duration_ms)
      WHERE namespace = ? AND id = ?
    `).run(patch.status ?? null, patch.result === undefined ? row.result_json : JSON.stringify(patch.result), patch.error === undefined ? null : patch.error, patch.permissionResult ?? null, patch.finishedAt ?? null, patch.durationMs ?? null, namespace, id)
  }

  listToolCalls(namespace: string, turnId: string): ToolCallRecord[] {
    const rows = this.db.prepare('SELECT * FROM tool_calls WHERE namespace = ? AND turn_id = ? ORDER BY started_at ASC, id ASC').all(namespace, turnId) as Array<{
      id: string; conversation_id: string; turn_id: string; run_id: string; tool_name: string; source: import('../shared/types').ToolSource | null; arguments_json: string; result_json: string | null;
      status: ToolCallRecord['status']; permission_result: string | null; started_at: string; finished_at: string | null; duration_ms: number | null; error: string | null
    }>
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      parentToolCallId: (row as { parent_tool_call_id?: string | null }).parent_tool_call_id ?? null,
      subAgentId: (row as { sub_agent_id?: string | null }).sub_agent_id ?? null,
      subAgentRunId: (row as { sub_agent_run_id?: string | null }).sub_agent_run_id ?? null,
      turnId: row.turn_id,
      runId: row.run_id,
      toolName: row.tool_name,
      source: row.source,
      arguments: parseJson(row.arguments_json, {}),
      result: row.result_json === null ? null : parseJson(row.result_json, null),
      status: row.status,
      permissionResult: row.permission_result,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      error: row.error
    }))
  }

  setTodos(namespace: string, conversationId: string, items: TodoItem[]): TodoItem[] {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM session_todos WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      const insert = this.db.prepare('INSERT INTO session_todos(namespace, conversation_id, item_id, content, status, position, phase, phase_position, delegated_task_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const now = new Date().toISOString()
      items.forEach((item, index) => {
        insert.run(namespace, conversationId, item.id, item.content, item.status, item.position ?? index, item.phase ?? null, item.phasePosition ?? 0, item.delegatedTaskId ?? null, now)
      })
    })
    transaction()
    return this.listTodos(namespace, conversationId)
  }

  listTodos(namespace: string, conversationId: string): TodoItem[] {
    const rows = this.db.prepare('SELECT item_id, content, status, position, phase, phase_position, delegated_task_id FROM session_todos WHERE namespace = ? AND conversation_id = ? ORDER BY phase_position ASC, position ASC, item_id ASC').all(namespace, conversationId) as Array<{ item_id: string; content: string; status: TodoItem['status']; position: number; phase: string | null; phase_position: number; delegated_task_id: string | null }>
    return rows.map((row) => ({
      id: row.item_id,
      content: row.content,
      status: row.status,
      position: row.position,
      // 不分组的会话不带这些字段，渲染层据此走扁平路径
      ...(row.phase ? { phase: row.phase, phasePosition: row.phase_position } : {}),
      ...(row.delegated_task_id ? { delegatedTaskId: row.delegated_task_id } : {})
    }))
  }

  listPermissionRules(namespace: string): StoredPermissionRule[] {
    const rows = this.db.prepare('SELECT tool_key, pattern, action, updated_at FROM permission_rules WHERE namespace = ? ORDER BY position ASC, updated_at ASC').all(namespace) as Array<{ tool_key: string; pattern: string; action: PermissionAction; updated_at: string }>
    return rows.map((row) => ({ toolKey: row.tool_key, pattern: row.pattern, action: row.action, updatedAt: row.updated_at }))
  }

  upsertPermissionRule(namespace: string, input: { toolKey: string; pattern: string; action: PermissionAction }) {
    const position = (this.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM permission_rules WHERE namespace = ?').get(namespace) as { next: number }).next
    this.db.prepare(`
      INSERT INTO permission_rules(namespace, tool_key, pattern, action, position, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, tool_key, pattern) DO UPDATE SET action = excluded.action, position = excluded.position, updated_at = excluded.updated_at
    `).run(namespace, input.toolKey, input.pattern, input.action, position, new Date().toISOString())
  }

  removePermissionRule(namespace: string, toolKey: string, pattern: string) {
    this.db.prepare('DELETE FROM permission_rules WHERE namespace = ? AND tool_key = ? AND pattern = ?').run(namespace, toolKey, pattern)
  }

  /** 只返回落库行；内置三档的补齐与排序由 shared/permission-profiles 的 mergeProfiles 负责。 */
  listPermissionProfiles(namespace: string): StoredPermissionProfile[] {
    const rows = this.db.prepare('SELECT profile_id, label, hint, base, builtin, overrides, position FROM permission_profiles WHERE namespace = ? ORDER BY position ASC, profile_id ASC').all(namespace) as Array<{ profile_id: string; label: string; hint: string; base: BuiltinPermissionPreset; builtin: number; overrides: string; position: number }>
    return rows.map((row) => ({
      id: row.profile_id,
      label: row.label,
      hint: row.hint,
      base: row.base,
      builtin: row.builtin === 1,
      overrides: sanitizeOverrides(parseJson<unknown>(row.overrides, {})),
      position: row.position
    }))
  }

  savePermissionProfile(namespace: string, profile: StoredPermissionProfile) {
    this.db.prepare(`
      INSERT INTO permission_profiles(namespace, profile_id, label, hint, base, builtin, overrides, position, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, profile_id) DO UPDATE SET
        label = excluded.label, hint = excluded.hint, base = excluded.base,
        overrides = excluded.overrides, position = excluded.position, updated_at = excluded.updated_at
    `).run(namespace, profile.id, profile.label, profile.hint, profile.base, profile.builtin ? 1 : 0, JSON.stringify(profile.overrides), profile.position, new Date().toISOString())
  }

  /** 内置档删除等于恢复出厂：删掉覆盖行后 mergeProfiles 会自动补回内置定义。 */
  removePermissionProfile(namespace: string, profileId: string) {
    this.db.prepare('DELETE FROM permission_profiles WHERE namespace = ? AND profile_id = ?').run(namespace, profileId)
  }

  close() {
    this.db.close()
  }
}
