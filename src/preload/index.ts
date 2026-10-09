import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AuthSnapshot, ArtifactQuery, BootstrapData, CaptchaData, FastAgentApi, AgentEvent, AppRuntimeInfo, ConversationPageQuery, PageQuery, PermissionPreset, ProjectRecord, RendererErrorReport, StartupWarnings, WorkspaceFileContent, WorkspaceFileMatch, WorkspaceListing, WorkspaceSnapshot, Ability, AbilityType, AppSettings, ApprovalDecision, ClientPreferences, DataStorageInfo, FileVersionRecord, InitProjectResult, KbEntry, KbIndexResult, KbSource, KbSourceKind, KbSourcePreview, LocalMcpServerInput,  LocalModelSummary, LocalModelTestResult, LocalSkillRecord, McpServerDetail, McpTestStatus, MemoryListQuery, MemoryScope, MemoryTurnActivity, MemoryUpdateInput, ModelUsageOverview, Plugin, PluginDetail, PluginInstallResult, PluginQuery, RuntimeReport, SandboxCapabilities, SandboxSessionInfo, SearchQuery, SearchResponse, SkillCheckResult, SkillDetail, SkillDraft, SkillVersionRecord, BundleExportOptions, BundleImportPlan, BundlePreview, HubInstallResult, HubInstalledAbility, HubListingDetail, HubQuery, HubSearchResult, HubSource, HubSourceInput, HubUpdateCheckResult, McpPromptDescriptor, McpPromptResult, McpResourceContent, McpResourceDescriptor, McpResourceTemplateDescriptor, TerminalChunk, TerminalExit, ModelUsageWindow, ShellCommandChunk } from '../shared/types'

/**
 * 主进程建窗时已经知道主题，用启动参数带过来。
 * 等渲染进程 IPC 拿设置再写 data-theme 就晚了：那时首帧已经按 CSS 默认的浅色画完，
 * 深色用户每次冷启动都会先看到一下浅色。
 */
function initialTheme(): 'light' | 'dark' {
  const flag = process.argv.find((argument) => argument.startsWith('--fastagent-theme='))
  if (flag) return flag.slice('--fastagent-theme='.length) === 'dark' ? 'dark' : 'light'
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const theme = initialTheme()

function applyInitialTheme() {
  document.documentElement.dataset.theme = theme
}

if (document.documentElement) applyInitialTheme()
else document.addEventListener('DOMContentLoaded', applyInitialTheme, { once: true })

const api: FastAgentApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', patch),
    onChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AppSettings) => listener(payload)
      ipcRenderer.on('settings:changed', handler)
      return () => ipcRenderer.removeListener('settings:changed', handler)
    },
    pickBashExecutable: (): Promise<string | null> => ipcRenderer.invoke('settings:pick-bash'),
    pickEditorExecutable: (): Promise<string | null> => ipcRenderer.invoke('settings:pick-editor')
  },
  storage: {
    info: (): Promise<DataStorageInfo> => ipcRenderer.invoke('storage:info'),
    openDataDirectory: (): Promise<string> => ipcRenderer.invoke('storage:open-data-directory'),
    openPath: (key: string): Promise<string> => ipcRenderer.invoke('storage:open-path', key),
    moveDataDirectory: () => ipcRenderer.invoke('storage:move-data-directory')
  },
  files: {
    getPath: (file: File) => webUtils.getPathForFile(file),
    readImage: (path: string): Promise<string | null> => ipcRenderer.invoke('files:read-image', path)
    ,saveClipboardImage: (dataUrl: string, name: string, type: string): Promise<string> => ipcRenderer.invoke('files:save-clipboard-image', dataUrl, name, type)
  },
  app: {
    info: (): Promise<AppRuntimeInfo> => ipcRenderer.invoke('app:info'),
    restart: (): Promise<boolean> => ipcRenderer.invoke('app:restart'),
    reload: (): Promise<boolean> => ipcRenderer.invoke('app:reload'),
    hideToTray: (): Promise<boolean> => ipcRenderer.invoke('app:hideToTray'),
    quit: (): Promise<boolean> => ipcRenderer.invoke('app:quit')
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (listener: (maximized: boolean) => void) => {
      const handler = (_event: unknown, maximized: boolean) => listener(maximized)
      ipcRenderer.on('window:maximized-changed', handler)
      return () => ipcRenderer.removeListener('window:maximized-changed', handler)
    }
  },
  startup: {
    ready: (): Promise<void> => ipcRenderer.invoke('startup:ready'),
    warnings: (): Promise<StartupWarnings> => ipcRenderer.invoke('startup:warnings'),
    onReveal: (listener: () => void) => {
      const handler = () => listener()
      ipcRenderer.on('startup:reveal', handler)
      return () => ipcRenderer.removeListener('startup:reveal', handler)
    }
  },
  diagnostics: {
    reportRendererError: (report: RendererErrorReport): Promise<void> => ipcRenderer.invoke('diagnostics:renderer-error', report)
  },
  initialTheme: theme,
  preferences: {
    get: (): Promise<ClientPreferences> => ipcRenderer.invoke('preferences:get'),
    update: (patch: Partial<ClientPreferences>): Promise<ClientPreferences> => ipcRenderer.invoke('preferences:update', patch)
  },
  auth: {
    snapshot: () => ipcRenderer.invoke('auth:snapshot'),
    captcha: (backendUrl: string): Promise<CaptchaData> => ipcRenderer.invoke('auth:captcha', backendUrl),
    login: (input) => ipcRenderer.invoke('auth:login', input),
    lock: () => ipcRenderer.invoke('auth:lock'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    requestLogin: (): Promise<AuthSnapshot> => ipcRenderer.invoke('auth:request-login'),
    enterWorkspace: (modelId?: number): Promise<AuthSnapshot> => ipcRenderer.invoke('auth:enter-workspace', modelId)
  },
  resources: {
    bootstrap: (): Promise<BootstrapData> => ipcRenderer.invoke('resources:bootstrap')
  },
  models: {
    localList: (): Promise<LocalModelSummary[]> => ipcRenderer.invoke('models:localList'),
    onChanged: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('models:changed', handler)
      return () => ipcRenderer.removeListener('models:changed', handler)
    },
    testDialogue: (id: number): Promise<LocalModelTestResult> => ipcRenderer.invoke('models:testDialogue', id),
    listOverrides: () => ipcRenderer.invoke('models:listOverrides'),
    setOverride: (provider: string, modelName: string, override) => ipcRenderer.invoke('models:setOverride', provider, modelName, override)
  },
  modelConnections: {
    providers: () => ipcRenderer.invoke('model-connections:providers'),
    list: () => ipcRenderer.invoke('model-connections:list'),
    save: (input) => ipcRenderer.invoke('model-connections:save', input),
    remove: (id: string) => ipcRenderer.invoke('model-connections:remove', id),
    models: (input) => ipcRenderer.invoke('model-connections:models', input),
    test: (input) => ipcRenderer.invoke('model-connections:test', input),
    startLogin: (providerId: string, connectionId?: string) => ipcRenderer.invoke('model-connections:start-login', providerId, connectionId),
    authState: (sessionId: string) => ipcRenderer.invoke('model-connections:auth-state', sessionId),
    answerLogin: (sessionId: string, value: string) => ipcRenderer.invoke('model-connections:answer-login', sessionId, value),
    cancelLogin: (sessionId: string) => ipcRenderer.invoke('model-connections:cancel-login', sessionId),
    logout: (id: string) => ipcRenderer.invoke('model-connections:logout', id)
  },
  doctor: {
    run: () => ipcRenderer.invoke('doctor:run'),
    export: (): Promise<string | null> => ipcRenderer.invoke('doctor:export')
  },
  runtime: {
    status: (verify?: boolean): Promise<RuntimeReport> => ipcRenderer.invoke('runtime:status', verify ?? false),
    repair: (): Promise<RuntimeReport> => ipcRenderer.invoke('runtime:repair')
  },
  sandbox: {
    status: (force?: boolean): Promise<SandboxCapabilities> => ipcRenderer.invoke('sandbox:status', force ?? false),
    initialize: (): Promise<SandboxCapabilities> => ipcRenderer.invoke('sandbox:initialize'),
    sessionInfo: (): Promise<SandboxSessionInfo | null> => ipcRenderer.invoke('sandbox:session-info')
  },
  skills: {
    list: (): Promise<LocalSkillRecord[]> => ipcRenderer.invoke('skills:list'),
    get: (name: string) => ipcRenderer.invoke('skills:get', name),
    create: (input) => ipcRenderer.invoke('skills:create', input),
    update: (name, patch) => ipcRenderer.invoke('skills:update', name, patch),
    setEnabled: (name, enabled) => ipcRenderer.invoke('skills:set-enabled', name, enabled),
    remove: (name) => ipcRenderer.invoke('skills:remove', name),
    import: (options) => ipcRenderer.invoke('skills:import', options ?? {}),
    distill: (conversationId: string, modelId: number | null): Promise<SkillDraft> => ipcRenderer.invoke('skills:distill', conversationId, modelId),
    versions: (name: string): Promise<SkillVersionRecord[]> => ipcRenderer.invoke('skills:versions', name),
    revert: (name: string, revision: number): Promise<LocalSkillRecord> => ipcRenderer.invoke('skills:revert', name, revision),
    check: (name: string): Promise<SkillCheckResult> => ipcRenderer.invoke('skills:check', name),
    detail: (name: string): Promise<SkillDetail> => ipcRenderer.invoke('skills:detail', name)
  },
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    save: (input) => ipcRenderer.invoke('mcp:save', input),
    setEnabled: (id, enabled) => ipcRenderer.invoke('mcp:set-enabled', id, enabled),
    remove: (id) => ipcRenderer.invoke('mcp:remove', id),
    test: (id: string): Promise<McpTestStatus> => ipcRenderer.invoke('mcp:test', id),
    status: (): Promise<Array<{ id: string } & McpTestStatus>> => ipcRenderer.invoke('mcp:status'),
    import: () => ipcRenderer.invoke('mcp:import'),
    testConfig: (input: LocalMcpServerInput): Promise<McpTestStatus> => ipcRenderer.invoke('mcp:test-config', input),
    detail: (id: string): Promise<McpServerDetail> => ipcRenderer.invoke('mcp:detail', id),
    resources: (id: string): Promise<{ resources: McpResourceDescriptor[]; templates: McpResourceTemplateDescriptor[] }> => ipcRenderer.invoke('mcp:resources', id),
    readResource: (id: string, uri: string): Promise<{ contents: McpResourceContent[] }> => ipcRenderer.invoke('mcp:read-resource', id, uri),
    prompts: (id: string): Promise<{ prompts: McpPromptDescriptor[] }> => ipcRenderer.invoke('mcp:prompts', id),
    getPrompt: (id: string, name: string, args?: Record<string, string>): Promise<McpPromptResult> => ipcRenderer.invoke('mcp:get-prompt', id, name, args ?? {})
  },
  abilities: {
    list: (): Promise<Ability[]> => ipcRenderer.invoke('abilities:list'),
    listPage: (query?: PageQuery) => ipcRenderer.invoke('abilities:list-page', query ?? {}),
    get: (type: AbilityType, id: string): Promise<Ability | null> => ipcRenderer.invoke('abilities:get', type, id),
    setEnabled: (type: AbilityType, id: string, enabled: boolean): Promise<Ability> => ipcRenderer.invoke('abilities:set-enabled', type, id, enabled),
    openLocation: (type: AbilityType, id: string): Promise<string> => ipcRenderer.invoke('abilities:open-location', type, id)
  },
  hub: {
    sources: (): Promise<HubSource[]> => ipcRenderer.invoke('hub:sources'),
    saveSource: (input: HubSourceInput): Promise<HubSource> => ipcRenderer.invoke('hub:save-source', input),
    removeSource: (id: string): Promise<void> => ipcRenderer.invoke('hub:remove-source', id),
    testSource: (id: string): Promise<HubSource> => ipcRenderer.invoke('hub:test-source', id),
    search: (query?: HubQuery): Promise<HubSearchResult> => ipcRenderer.invoke('hub:search', query ?? {}),
    detail: (sourceId: string, ref: string): Promise<HubListingDetail> => ipcRenderer.invoke('hub:detail', sourceId, ref),
    install: (sourceId: string, ref: string, config?: Record<string, string>): Promise<HubInstallResult> => ipcRenderer.invoke('hub:install', sourceId, ref, config),
    categories: (): Promise<string[]> => ipcRenderer.invoke('hub:categories'),
    checkUpdates: (): Promise<HubUpdateCheckResult> => ipcRenderer.invoke('hub:check-updates')
  },
  bundle: {
    export: (options: BundleExportOptions): Promise<string | null> => ipcRenderer.invoke('bundle:export', options),
    exportSkill: (name: string): Promise<string | null> => ipcRenderer.invoke('bundle:export-skill', name),
    preview: (passphrase?: string): Promise<BundlePreview | null> => ipcRenderer.invoke('bundle:preview', passphrase),
    previewPath: (path: string, passphrase?: string): Promise<BundlePreview> => ipcRenderer.invoke('bundle:preview-path', path, passphrase),
    import: (path: string, plan: BundleImportPlan): Promise<HubInstalledAbility[]> => ipcRenderer.invoke('bundle:import', path, plan)
  },
  plugins: {
    list: (query?: PluginQuery): Promise<Plugin[]> => ipcRenderer.invoke('plugins:list', query ?? {}),
    listPage: (query?: PluginQuery) => ipcRenderer.invoke('plugins:list-page', query ?? {}),
    get: (id: string): Promise<PluginDetail | null> => ipcRenderer.invoke('plugins:get', id),
    install: (id: string, config?: Record<string, string>): Promise<PluginInstallResult> => ipcRenderer.invoke('plugins:install', id, config),
    uninstall: (id: string): Promise<void> => ipcRenderer.invoke('plugins:uninstall', id),
    categories: (): Promise<string[]> => ipcRenderer.invoke('plugins:categories')
  },
  chat: {
    send: (input) => ipcRenderer.invoke('chat:send', input),
    quickSend: (input) => ipcRenderer.invoke('chat:quick-send', input),
    cancel: (runId: string) => ipcRenderer.invoke('chat:cancel', runId),
    steer: (input) => ipcRenderer.invoke('chat:steer', input),
    pause: (runId: string): Promise<boolean> => ipcRenderer.invoke('chat:pause', runId),
    resume: (runId: string): Promise<boolean> => ipcRenderer.invoke('chat:resume', runId),
    setPermission: (runId: string, preset: PermissionPreset | null) => ipcRenderer.invoke('chat:set-permission', runId, preset),
    respondApproval: (id: string, decision: ApprovalDecision, answer: string | undefined, runId: string) => ipcRenderer.invoke('chat:approval-respond', { id, decision, answer, runId }),
    onEvent: (listener: (event: AgentEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => listener(payload)
      ipcRenderer.on('chat:event', handler)
      return () => ipcRenderer.removeListener('chat:event', handler)
    },
    listStates: () => ipcRenderer.invoke('run-states:list'),
    listActive: () => ipcRenderer.invoke('chat:list-active'),
    listPendingApprovals: () => ipcRenderer.invoke('chat:list-pending-approvals'),
    saveState: (state) => ipcRenderer.invoke('run-states:save', state),
    markRead: (conversationId: string) => ipcRenderer.invoke('run-states:read', conversationId)
  },
  usage: {
    overview: (window: ModelUsageWindow): Promise<ModelUsageOverview> => ipcRenderer.invoke('usage:overview', window)
  },
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    get: (conversationId: string) => ipcRenderer.invoke('conversations:get', conversationId),
    listPage: (query?: ConversationPageQuery) => ipcRenderer.invoke('conversations:list-page', query ?? {}),
    listDetailed: () => ipcRenderer.invoke('conversation:listDetailed'),
    listDetailedPage: (query?: ConversationPageQuery) => ipcRenderer.invoke('conversation:listDetailed-page', query ?? {}),
    stats: (includeArchived?: boolean) => ipcRenderer.invoke('conversations:stats', includeArchived ?? false),
    history: (conversationId: string) => ipcRenderer.invoke('conversations:history', conversationId),
    getInspector: (conversationId: string) => ipcRenderer.invoke('conversation:getInspector', conversationId),
    updateContextPolicy: (conversationId, patch) => ipcRenderer.invoke('conversation:updateContextPolicy', conversationId, patch),
    compactNow: (conversationId, modelId) => ipcRenderer.invoke('conversation:compactNow', conversationId, modelId),
    cancelCompaction: (conversationId) => ipcRenderer.invoke('conversation:cancelCompaction', conversationId),
    getCompactionHistory: (conversationId) => ipcRenderer.invoke('conversation:getCompactionHistory', conversationId),
    refreshContext: (conversationId, modelId) => ipcRenderer.invoke('conversation:refreshContext', conversationId, modelId),
    modelUsage: (conversationId: string, turnId?: string) => ipcRenderer.invoke('conversation:model-usage', conversationId, turnId),
    listToolCalls: (turnId: string) => ipcRenderer.invoke('conversations:listToolCalls', turnId),
    contextSources: (turnId: string) => ipcRenderer.invoke('conversations:contextSources', turnId),
    contextSourceTurns: (conversationId: string) => ipcRenderer.invoke('conversations:contextSourceTurns', conversationId),
    listTodos: (conversationId: string) => ipcRenderer.invoke('conversations:listTodos', conversationId),
    listPermissionRules: () => ipcRenderer.invoke('conversations:listPermissionRules'),
    upsertPermissionRule: (rule) => ipcRenderer.invoke('conversations:upsertPermissionRule', rule),
    removePermissionRule: (toolKey: string, pattern: string) => ipcRenderer.invoke('conversations:removePermissionRule', toolKey, pattern),
    listPermissionProfiles: () => ipcRenderer.invoke('conversations:listPermissionProfiles'),
    savePermissionProfile: (profile) => ipcRenderer.invoke('conversations:savePermissionProfile', profile),
    removePermissionProfile: (profileId: string) => ipcRenderer.invoke('conversations:removePermissionProfile', profileId),
    createTurn: (input) => ipcRenderer.invoke('turns:create', input),
    updateTurn: (turnId, patch) => ipcRenderer.invoke('turns:update', turnId, patch),
    deleteTurn: (turnId) => ipcRenderer.invoke('turns:delete', turnId),
    restoreTurn: (turn) => ipcRenderer.invoke('turns:restore', turn),
    create: (input: { title: string; projectId?: string | null }) => ipcRenderer.invoke('conversations:create', input),
    setModel: (conversationId: string, modelId: number | null) => ipcRenderer.invoke('conversations:setModel', conversationId, modelId),
    openSessionDirectory: (conversationId: string): Promise<string> => ipcRenderer.invoke('conversations:openSessionDirectory', conversationId),
    rename: (conversationId: string, title: string) => ipcRenderer.invoke('conversations:rename', conversationId, title),
    /** 弹保存对话框把会话导出为 Markdown / HTML（由对话框过滤器决定）；取消时返回 null。 */
    export: (conversationId: string): Promise<string | null> => ipcRenderer.invoke('conversations:export', conversationId),
    archive: (conversationId: string) => ipcRenderer.invoke('conversations:archive', conversationId),
    remove: (conversationId: string) => ipcRenderer.invoke('conversations:remove', conversationId),
    clear: (conversationId: string) => ipcRenderer.invoke('conversations:clear', conversationId)
  },
  workspace: {
    pickRoot: (): Promise<string | null> => ipcRenderer.invoke('workspace:pick-root'),
    setRoot: (path: string | null): Promise<string | null> => ipcRenderer.invoke('workspace:set-root', path),
    initProject: (options?: { force?: boolean }): Promise<InitProjectResult> => ipcRenderer.invoke('workspace:init-project', options ?? {}),
    snapshot: (): Promise<WorkspaceSnapshot> => ipcRenderer.invoke('workspace:snapshot'),
    readFile: (path: string): Promise<WorkspaceFileContent> => ipcRenderer.invoke('workspace:read-file', path),
    readImage: (path: string): Promise<{ path: string; dataUrl: string }> => ipcRenderer.invoke('workspace:read-image', path),
    listDirectory: (path: string): Promise<WorkspaceListing> => ipcRenderer.invoke('workspace:list-directory', path),
    searchFiles: (query: string): Promise<WorkspaceFileMatch[]> => ipcRenderer.invoke('workspace:search-files', query),
    reveal: (path: string): Promise<string> => ipcRenderer.invoke('workspace:reveal', path),
    exists: (path: string): Promise<boolean> => ipcRenderer.invoke('workspace:exists', path),
    absolutePath: (path: string): Promise<string> => ipcRenderer.invoke('workspace:absolute-path', path),
    openExternal: (path: string): Promise<string> => ipcRenderer.invoke('workspace:open-external', path),
    openTerminal: (): Promise<string> => ipcRenderer.invoke('workspace:open-terminal'),
    delete: (path: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('workspace:delete', path)
  },
  git: {
    state: () => ipcRenderer.invoke('git:state'),
    branches: () => ipcRenderer.invoke('git:branches'),
    checkout: (branch: string) => ipcRenderer.invoke('git:checkout', branch),
    create: (name: string) => ipcRenderer.invoke('git:create', name),
    status: () => ipcRenderer.invoke('git:status'),
    onChanged: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('git:changed', handler)
      return () => ipcRenderer.removeListener('git:changed', handler)
    }
  },
  projects: {
    list: (): Promise<ProjectRecord[]> => ipcRenderer.invoke('projects:list'),
    listPage: (query?: PageQuery) => ipcRenderer.invoke('projects:list-page', query ?? {}),
    add: (input: { path: string; name?: string }): Promise<ProjectRecord> => ipcRenderer.invoke('projects:add', input),
    touch: (id: string): Promise<ProjectRecord | null> => ipcRenderer.invoke('projects:touch', id),
    archive: (id: string): Promise<void> => ipcRenderer.invoke('projects:archive', id),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('projects:remove', id),
    trustStatus: (path: string): Promise<{ trusted: boolean; hasAgentContextFiles: boolean }> => ipcRenderer.invoke('projects:trust-status', path),
    setTrust: (path: string, trusted: boolean): Promise<{ trusted: boolean }> => ipcRenderer.invoke('projects:set-trust', path, trusted)
  },
  search: {
    query: (input: SearchQuery): Promise<SearchResponse> => ipcRenderer.invoke('search:query', input)
  },
  knowledgeBase: {
    list: (projectId: string): Promise<KbEntry[]> => ipcRenderer.invoke('kb:list', projectId),
    save: (projectId: string, input: { id?: string; title: string; content: string }): Promise<KbEntry> => ipcRenderer.invoke('kb:save', projectId, input),
    remove: (projectId: string, entryId: string): Promise<void> => ipcRenderer.invoke('kb:remove', projectId, entryId),
    listSources: (projectId: string): Promise<KbSource[]> => ipcRenderer.invoke('kb:listSources', projectId),
    pickSource: (kind: KbSourceKind): Promise<KbSourcePreview | null> => ipcRenderer.invoke('kb:pickSource', kind),
    previewSource: (path: string, kind: KbSourceKind, excludes?: string[]): Promise<KbSourcePreview> => ipcRenderer.invoke('kb:previewSource', path, kind, excludes),
    addSource: (projectId: string, input: { path: string; kind: KbSourceKind; title?: string; excludes?: string[] }): Promise<KbIndexResult> => ipcRenderer.invoke('kb:addSource', projectId, input),
    refreshSource: (sourceId: string): Promise<KbIndexResult> => ipcRenderer.invoke('kb:refreshSource', sourceId),
    removeSource: (sourceId: string): Promise<void> => ipcRenderer.invoke('kb:removeSource', sourceId),
    onChanged: (listener: (projectId: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, projectId: string) => listener(projectId)
      ipcRenderer.on('kb:changed', handler)
      return () => ipcRenderer.removeListener('kb:changed', handler)
    }
  },
  artifacts: {
    list: (query?: ArtifactQuery) => ipcRenderer.invoke('artifacts:list', query ?? {}),
    remove: (artifactId: string) => ipcRenderer.invoke('artifacts:remove', artifactId),
    versions: (artifactId: string): Promise<FileVersionRecord[]> => ipcRenderer.invoke('artifacts:versions', artifactId),
    versionDiff: (artifactId: string, turnId: string): Promise<string | null> => ipcRenderer.invoke('artifacts:versionDiff', artifactId, turnId),
    restore: (artifactId: string, turnId: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('artifacts:restore', artifactId, turnId),
    onChanged: (listener: () => void) => {
      const handler = () => listener()
      ipcRenderer.on('artifacts:changed', handler)
      return () => ipcRenderer.removeListener('artifacts:changed', handler)
    }
  },
  agentRuns: {
    list: (conversationId: string, limit?: number) => ipcRenderer.invoke('agent-runs:list', conversationId, limit),
    listTasks: (query: { runId?: string; conversationId?: string; turnId?: string; limit?: number }) => ipcRenderer.invoke('agent-tasks:list', query),
    resumable: (conversationId: string) => ipcRenderer.invoke('agent-runs:resumable', conversationId),
    resumePrompt: (runId: string) => ipcRenderer.invoke('agent-runs:resume-prompt', runId)
  },
  memories: {
    list: (query?: MemoryListQuery) => ipcRenderer.invoke('memories:list', query ?? {}),
    update: (id: string, patch: MemoryUpdateInput) => ipcRenderer.invoke('memories:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('memories:remove', id),
    clear: (scope?: MemoryScope, scopeId?: string | null) => ipcRenderer.invoke('memories:clear', scope, scopeId ?? null),
    turnActivity: (turnId: string): Promise<MemoryTurnActivity> => ipcRenderer.invoke('memories:turn-activity', turnId),
    conversationActivity: (conversationId: string): Promise<string[]> => ipcRenderer.invoke('memories:conversation-activity', conversationId),
    onChanged: (listener: () => void) => {
      const handler = () => listener()
      ipcRenderer.on('memories:changed', handler)
      return () => ipcRenderer.removeListener('memories:changed', handler)
    }
  },
  changes: {
    list: (turnId: string) => ipcRenderer.invoke('changes:list', turnId),
    diff: (turnId: string, path: string) => ipcRenderer.invoke('changes:diff', turnId, path),
    revert: (turnId: string) => ipcRenderer.invoke('changes:revert', turnId)
  },
  composer: {
    openExternalEditor: (text: string) => ipcRenderer.invoke('composer:external-edit-open', text),
    readExternalEditor: (path: string) => ipcRenderer.invoke('composer:external-edit-read', path)
  },
  quick: {
    hide: () => ipcRenderer.invoke('quick:hide'),
    setPinned: (pinned: boolean) => ipcRenderer.invoke('quick:setPinned', pinned)
  },
  shell: {
    openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:open-path', path),
    openExternal: (url: string): Promise<string> => ipcRenderer.invoke('shell:open-external', url),
    runCommand: (input) => ipcRenderer.invoke('shell:run-command', input),
    cancelCommand: (id: string) => ipcRenderer.invoke('shell:cancel-command', id),
    onCommandOutput: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: ShellCommandChunk) => listener(payload)
      ipcRenderer.on('shell:command-output', handler)
      return () => ipcRenderer.removeListener('shell:command-output', handler)
    }
  },
  terminal: {
    list: () => ipcRenderer.invoke('terminal:list'),
    create: (options?: { cols?: number; rows?: number }) => ipcRenderer.invoke('terminal:create', options ?? {}),
    attach: (id: string) => ipcRenderer.invoke('terminal:attach', id),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    close: (id: string) => ipcRenderer.invoke('terminal:close', id),
    onData: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalChunk) => listener(payload)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },
    onExit: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalExit) => listener(payload)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    }
  },
  onAuthState: (listener: (snapshot: AuthSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AuthSnapshot) => listener(payload)
    ipcRenderer.on('auth:state', handler)
    return () => ipcRenderer.removeListener('auth:state', handler)
  },
  onTrayNewConversation: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('tray:new-conversation', handler)
    return () => ipcRenderer.removeListener('tray:new-conversation', handler)
  },
  onTrayHidden: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('window:tray-hidden', handler)
    return () => ipcRenderer.removeListener('window:tray-hidden', handler)
  }
}

contextBridge.exposeInMainWorld('fastAgent', api)
