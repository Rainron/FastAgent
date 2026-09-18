import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AuthSnapshot, ArtifactQuery, BootstrapData, CaptchaData, FastAgentApi, AgentEvent, AppRuntimeInfo, ConversationPageQuery, PageQuery, PermissionPreset, ProjectRecord, RendererErrorReport, StartupWarnings, WorkspaceFileContent, WorkspaceFileMatch, WorkspaceListing, WorkspaceSnapshot, Ability, AbilityType, AppSettings, ApprovalDecision, ClientPreferences, DataStorageInfo, InitProjectResult, LocalMcpServerInput, LocalModelInput, LocalModelSummary, LocalModelTestResult, LocalSkillRecord, McpServerDetail, McpTestStatus, MemoryListQuery, MemoryScope, MemoryUpdateInput, Plugin, PluginDetail, PluginInstallResult, PluginQuery, RuntimeReport, SandboxCapabilities, SandboxSessionInfo, SkillDetail, BundleExportOptions, BundleImportPlan, BundlePreview, HubInstallResult, HubInstalledAbility, HubListingDetail, HubQuery, HubSearchResult, HubSource, HubSourceInput, HubUpdateCheckResult } from '../shared/types'

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
    getPath: (file: File) => webUtils.getPathForFile(file)
  },
  app: {
    info: (): Promise<AppRuntimeInfo> => ipcRenderer.invoke('app:info'),
    restart: (): Promise<boolean> => ipcRenderer.invoke('app:restart'),
    reload: (): Promise<boolean> => ipcRenderer.invoke('app:reload'),
    hideToTray: (): Promise<boolean> => ipcRenderer.invoke('app:hideToTray'),
    quit: (): Promise<boolean> => ipcRenderer.invoke('app:quit')
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
    localCreate: (input: LocalModelInput) => ipcRenderer.invoke('models:localCreate', input),
    localUpdate: (id: number, input: LocalModelInput) => ipcRenderer.invoke('models:localUpdate', id, input),
    localDelete: (id: number) => ipcRenderer.invoke('models:localDelete', id),
    localTest: (id: number): Promise<LocalModelTestResult> => ipcRenderer.invoke('models:localTest', id)
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
    run: () => ipcRenderer.invoke('doctor:run')
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
    detail: (id: string): Promise<McpServerDetail> => ipcRenderer.invoke('mcp:detail', id)
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
    setPermission: (runId: string, preset: PermissionPreset | null) => ipcRenderer.invoke('chat:set-permission', runId, preset),
    respondApproval: (id: string, decision: ApprovalDecision, answer: string | undefined, runId: string) => ipcRenderer.invoke('chat:approval-respond', { id, decision, answer, runId }),
    onEvent: (listener: (event: AgentEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => listener(payload)
      ipcRenderer.on('chat:event', handler)
      return () => ipcRenderer.removeListener('chat:event', handler)
    },
    listStates: () => ipcRenderer.invoke('run-states:list'),
    listActive: () => ipcRenderer.invoke('chat:list-active'),
    saveState: (state) => ipcRenderer.invoke('run-states:save', state),
    markRead: (conversationId: string) => ipcRenderer.invoke('run-states:read', conversationId)
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
    absolutePath: (path: string): Promise<string> => ipcRenderer.invoke('workspace:absolute-path', path),
    openExternal: (path: string): Promise<string> => ipcRenderer.invoke('workspace:open-external', path),
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
    archive: (id: string): Promise<void> => ipcRenderer.invoke('projects:archive', id),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('projects:remove', id)
  },
  artifacts: {
    list: (query?: ArtifactQuery) => ipcRenderer.invoke('artifacts:list', query ?? {}),
    remove: (artifactId: string) => ipcRenderer.invoke('artifacts:remove', artifactId),
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
    onChanged: (listener: () => void) => {
      const handler = () => listener()
      ipcRenderer.on('memories:changed', handler)
      return () => ipcRenderer.removeListener('memories:changed', handler)
    }
  },
  changes: {
    list: (turnId: string) => ipcRenderer.invoke('changes:list', turnId),
    diff: (turnId: string, path: string) => ipcRenderer.invoke('changes:diff', turnId, path)
  },
  composer: {
    openExternalEditor: (text: string) => ipcRenderer.invoke('composer:external-edit-open', text),
    readExternalEditor: (path: string) => ipcRenderer.invoke('composer:external-edit-read', path)
  },
  quick: {
    hide: () => ipcRenderer.invoke('quick:hide')
  },
  shell: {
    openPath: (path: string): Promise<string> => ipcRenderer.invoke('shell:open-path', path),
    openExternal: (url: string): Promise<string> => ipcRenderer.invoke('shell:open-external', url)
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
