import type { PermissionProfile, StoredPermissionProfile } from '../permission-profiles'
import type { PermissionAction } from '../permission-rules'
import type { Ability, AbilityType, DoctorReport, LocalMcpServer, LocalMcpServerInput, LocalSkillRecord, McpServerDetail, McpTestStatus, SkillDetail } from './abilities'
import type { BundleExportOptions, BundleImportPlan, BundlePreview } from './bundle'
import type { HubInstallResult, HubInstalledAbility, HubListingDetail, HubQuery, HubSearchResult, HubSource, HubSourceInput, HubUpdateCheckResult } from './hub'
import type { AgentEvent, ToolCallRecord } from './agent-events'
import type { AgentRunChanges } from './changes'
import type { ActiveRunInfo, AgentRunLedgerEntry, AgentTaskRecord, ResumableRun } from './agent-runs'
import type { AuthSnapshot, BootstrapData, CaptchaData } from './auth'
import type { ApprovalDecision, ConversationMode, ConversationRunState, PermissionPreset, ThinkingLevel, TodoItem } from './common'
import type { CompactionHistory, ContextPolicy, ContextState, ContextSummary, ModelUsageSummary } from './context'
import type { Attachment, ConversationDetailed, ConversationInspector, ConversationPageQuery, ConversationRecord, ConversationStats, ConversationTurn, ConversationTurnPatch } from './conversation'
import type { MemoryListQuery, MemoryRecord, MemoryScope, MemoryUpdateInput } from './memory'
import type { LocalModelInput, LocalModelSummary, LocalModelTestResult } from './models'
import type { ModelConnectionsApi } from './model-connections'
import type { PageQuery, PageResult, Plugin, PluginDetail, PluginInstallResult, PluginQuery } from './plugins'
import type { RuntimeReport } from './runtime'
import type { SandboxCapabilities, SandboxSessionInfo } from './sandbox'
import type { AppRuntimeInfo, AppSettings, ClientPreferences, DataStorageInfo, RendererErrorReport, StartupWarnings, StoredPermissionRule } from './settings'
import type { Artifact, ArtifactQuery, GitOperationResult, GitStatusEntry, GitWorkspaceState, InitProjectResult, ProjectRecord, WorkspaceFileContent, WorkspaceFileMatch, WorkspaceListing, WorkspaceSnapshot } from './workspace'

export interface FastAgentApi {
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
    onChange(listener: (settings: AppSettings) => void): () => void
    /** 弹系统文件选择器选 bash.exe；取消时返回 null */
    pickBashExecutable(): Promise<string | null>
    /** 弹系统文件选择器选外部编辑器可执行文件；取消时返回 null */
    pickEditorExecutable(): Promise<string | null>
  }
  storage: {
    info(): Promise<DataStorageInfo>
    openDataDirectory(): Promise<string>
    openPath(key: 'dataRoot' | 'databasePath' | 'sessionsDir' | 'agentDir' | 'skillsDir' | 'mcpDir' | 'pluginsDir' | 'attachmentsDir' | 'backupsDir' | 'exportsDir' | 'cacheDir' | 'logsDir' | 'tempDir'): Promise<string>
    moveDataDirectory(): Promise<{ moved: boolean; cancelled?: boolean }>
  }
  files: {
    /** Electron 受控环境中通过 webUtils 取得用户选择或粘贴文件的本地路径。 */
    getPath(file: File): string
  }
  app: {
    info(): Promise<AppRuntimeInfo>
    /** 返回 false 表示用户在「有任务运行」的确认框里取消了。 */
    restart(): Promise<boolean>
    reload(): Promise<boolean>
    /** 隐藏主窗口只留托盘图标；窗口本就不可见时返回 false。 */
    hideToTray(): Promise<boolean>
    quit(): Promise<boolean>
  }
  startup: {
    /** 首屏数据已就绪并完成一次绘制；主进程据此显示主窗口并淡出启动页。 */
    ready(): Promise<void>
    /** 启动期收集到的非致命失败，进入主界面后一次性取回。 */
    warnings(): Promise<StartupWarnings>
    /** 主窗口即将显示：此刻才开始正文淡入，避免动画在不可见时空放。 */
    onReveal(listener: () => void): () => void
  }
  diagnostics: {
    /** 界面未捕获异常上报；只进日志，不改变界面既有的错误展示。 */
    reportRendererError(report: RendererErrorReport): Promise<void>
  }
  /** 主进程在建窗时定下的主题，preload 已据此写好 data-theme，供渲染进程首帧直接复用。 */
  initialTheme: 'light' | 'dark'
  preferences: {
    get(): Promise<ClientPreferences>
    update(patch: Partial<ClientPreferences>): Promise<ClientPreferences>
  }
  auth: {
    snapshot(): Promise<AuthSnapshot>
    captcha(backendUrl: string): Promise<CaptchaData>
    login(input: { backendUrl: string; username: string; password: string; captchaId: string; captchaAngle: number; remember: boolean }): Promise<AuthSnapshot>
    lock(): Promise<AuthSnapshot>
    logout(): Promise<AuthSnapshot>
    enterWorkspace(modelId?: number): Promise<AuthSnapshot>
  }
  resources: {
    bootstrap(): Promise<BootstrapData>
  }
  models: {
    localList(): Promise<LocalModelSummary[]>
    onChanged(listener: () => void): () => void
    localCreate(input: LocalModelInput): Promise<LocalModelSummary>
    localUpdate(id: number, input: LocalModelInput): Promise<LocalModelSummary>
    localDelete(id: number): Promise<void>
    localTest(id: number): Promise<LocalModelTestResult>
  }
  modelConnections: ModelConnectionsApi
  doctor: {
    /** 跑一次环境体检：开发工具、Shell、沙箱、工作区、能力。只探测与报缺，不做任何安装。 */
    run(): Promise<DoctorReport>
  }
  runtime: {
    /** 内置工具链现状。verify 为 true 时逐个算 sha256 与清单比对，耗时明显更长。 */
    status(verify?: boolean): Promise<RuntimeReport>
    /** 从随包副本整份重装到数据根，用于文件被替换或损坏后的修复。 */
    repair(): Promise<RuntimeReport>
  }
  sandbox: {
    /** 缓存的能力探测结果；force 为 true 时重新探测。 */
    status(force?: boolean): Promise<SandboxCapabilities>
    /** 以管理员权限运行一次性初始化程序，完成后返回最新能力。 */
    initialize(): Promise<SandboxCapabilities>
    /** 当前 Agent 运行使用的沙箱会话；无活动会话时为 null。 */
    sessionInfo(): Promise<SandboxSessionInfo | null>
  }
  skills: {
    list(): Promise<LocalSkillRecord[]>
    get(name: string): Promise<{ name: string; description: string; filePath: string; enabled: boolean; instructions: string }>
    create(input: { name: string; description: string; instructions: string }): Promise<LocalSkillRecord>
    update(name: string, patch: { description?: string; instructions?: string }): Promise<LocalSkillRecord>
    setEnabled(name: string, enabled: boolean): Promise<LocalSkillRecord>
    remove(name: string): Promise<void>
    /** 文件对话框选择 SKILL.md、目录或 ZIP，返回导入的 Skill；用户取消时返回 null。 */
    import(options?: { format?: 'directory' | 'zip'; onConflict?: 'overwrite' | 'save-as' }): Promise<LocalSkillRecord | null>
    /** 元数据 + 指令 + 文件树，供详情面板展示。 */
    detail(name: string): Promise<SkillDetail>
  }
  mcp: {
    list(): Promise<LocalMcpServer[]>
    save(input: LocalMcpServerInput): Promise<LocalMcpServer>
    setEnabled(id: string, enabled: boolean): Promise<LocalMcpServer>
    remove(id: string): Promise<void>
    /** 连接测试并抓取工具列表，结果登记到连接状态注册表。 */
    test(id: string): Promise<McpTestStatus>
    /** 返回本进程内已记录的各 Server 连接状态。 */
    status(): Promise<Array<{ id: string } & McpTestStatus>>
    /** 文件对话框选择 JSON 配置批量导入，返回新创建的 Server；用户取消时返回 null。 */
    import(): Promise<LocalMcpServer[] | null>
    /** 保存前测试草稿配置，不落库。 */
    testConfig(input: LocalMcpServerInput): Promise<McpTestStatus>
    /** 概览 + tools + 配置回显；密钥只回传 key 与 hasValue。 */
    detail(id: string): Promise<McpServerDetail>
  }
  abilities: {
    list(): Promise<Ability[]>
    listPage(query?: PageQuery): Promise<PageResult<Ability>>
    get(type: AbilityType, id: string): Promise<Ability | null>
    setEnabled(type: AbilityType, id: string, enabled: boolean): Promise<Ability>
    /** 在系统文件管理器中打开能力所在目录，成功返回空串。 */
    openLocation(type: AbilityType, id: string): Promise<string>
  }
  hub: {
    sources(): Promise<HubSource[]>
    /** apiKey 只上行不回传；不传 apiKey 时保留已存的值。 */
    saveSource(input: HubSourceInput): Promise<HubSource>
    removeSource(id: string): Promise<void>
    /** 拉一条结果验证可达，结果落回源行。 */
    testSource(id: string): Promise<HubSource>
    search(query?: HubQuery): Promise<HubSearchResult>
    detail(sourceId: string, ref: string): Promise<HubListingDetail>
    install(sourceId: string, ref: string, config?: Record<string, string>): Promise<HubInstallResult>
    categories(): Promise<string[]>
    /** 给已安装的 Hub 能力对一遍远端版本并落库，供能力页与侧栏徽标离线判断。 */
    checkUpdates(): Promise<HubUpdateCheckResult>
  }
  bundle: {
    /** 弹保存对话框写出整包；用户取消时返回 null，否则返回落地路径。 */
    export(options: BundleExportOptions): Promise<string | null>
    exportSkill(name: string): Promise<string | null>
    /** 弹文件对话框选包并解析；加密包未给口令时 contents 为 null 且 needsPassphrase 为 true。 */
    preview(passphrase?: string): Promise<BundlePreview | null>
    previewPath(path: string, passphrase?: string): Promise<BundlePreview>
    import(path: string, plan: BundleImportPlan): Promise<HubInstalledAbility[]>
  }
  plugins: {
    list(query?: PluginQuery): Promise<Plugin[]>
    listPage(query?: PluginQuery): Promise<PageResult<Plugin>>
    get(id: string): Promise<PluginDetail | null>
    install(id: string, config?: Record<string, string>): Promise<PluginInstallResult>
    uninstall(id: string): Promise<void>
    categories(): Promise<string[]>
  }
  chat: {
    send(input: { conversationId: string; turnId?: string; mode: ConversationMode; modelId: number | null; thinkingLevel: ThinkingLevel; permission: PermissionPreset | null; modePrompt: string; /** 计划模式：写入类工具在主进程被硬拒绝 */ planMode: boolean; prompt: string; attachments: Attachment[] }): Promise<{ runId: string; turnId: string; turn: ConversationTurn }>
    /** 快速对话专用：直接调模型接口，不走 pi 运行时，无工具 / MCP / 权限审批 */
    quickSend(input: { conversationId: string; prompt: string; modelId: number | null; thinkingLevel: ThinkingLevel }): Promise<{ runId: string; turnId: string; turn: ConversationTurn }>
    cancel(runId: string): Promise<void>
    /** 运行途中改权限档位：立刻对当前这一轮生效；run 已结束时返回 false。 */
    setPermission(runId: string, preset: PermissionPreset | null): Promise<boolean>
    respondApproval(id: string, decision: ApprovalDecision, answer: string | undefined, runId: string): Promise<void>
    onEvent(listener: (event: AgentEvent) => void): () => void
    listStates(): Promise<ConversationRunState[]>
    /** 主进程里仍在跑的 run；界面重载后靠它接回运行中的会话与回合。 */
    listActive(): Promise<ActiveRunInfo[]>
    saveState(state: ConversationRunState): Promise<void>
    markRead(conversationId: string): Promise<void>
  }
  conversations: {
    list(): Promise<ConversationRecord[]>
    get(conversationId: string): Promise<ConversationRecord | null>
    listPage(query?: ConversationPageQuery): Promise<PageResult<ConversationRecord>>
    listDetailed(): Promise<ConversationDetailed[]>
    listDetailedPage(query?: ConversationPageQuery): Promise<PageResult<ConversationDetailed>>
    stats(includeArchived?: boolean): Promise<ConversationStats>
    history(conversationId: string): Promise<ConversationTurn[]>
    getInspector(conversationId: string): Promise<ConversationInspector | null>
    updateContextPolicy(conversationId: string, patch: Partial<Omit<ContextPolicy, 'conversationId'>>): Promise<ContextPolicy>
    compactNow(conversationId: string, modelId?: number | null): Promise<{ context: ContextState; summary: ContextSummary; compaction: CompactionHistory } | null>
    cancelCompaction(conversationId: string): Promise<void>
    getCompactionHistory(conversationId: string): Promise<CompactionHistory[]>
    refreshContext(conversationId: string, modelId: number | null): Promise<ContextState>
    modelUsage(conversationId: string, turnId?: string): Promise<ModelUsageSummary>
    listToolCalls(turnId: string): Promise<ToolCallRecord[]>
    listTodos(conversationId: string): Promise<TodoItem[]>
    listPermissionRules(): Promise<StoredPermissionRule[]>
    upsertPermissionRule(rule: { toolKey: string; pattern: string; action: PermissionAction }): Promise<StoredPermissionRule[]>
    removePermissionRule(toolKey: string, pattern: string): Promise<void>
    /** 权限档位：内置三档恒在列表最前，返回的一律是合并后的完整列表 */
    listPermissionProfiles(): Promise<PermissionProfile[]>
    savePermissionProfile(profile: StoredPermissionProfile): Promise<PermissionProfile[]>
    /** 内置档位调用它等于恢复出厂设置；自定义档位是真删除 */
    removePermissionProfile(profileId: string): Promise<PermissionProfile[]>
    createTurn(input: { conversationId: string; prompt: string; attachments?: Attachment[]; mode: ConversationMode; modelId: number | null; thinkingLevel: ThinkingLevel; permission: PermissionPreset | null; project?: string | null }): Promise<ConversationTurn>
    updateTurn(turnId: string, patch: ConversationTurnPatch): Promise<ConversationTurn | null>
    deleteTurn(turnId: string): Promise<ConversationTurn | null>
    restoreTurn(turn: ConversationTurn): Promise<ConversationTurn>
    create(input: { title: string; projectId?: string | null }): Promise<ConversationRecord>
    /** 会话内切换模型时立刻落库，不必等到下一次发送。 */
    setModel(conversationId: string, modelId: number | null): Promise<void>
    /** 在文件管理器里打开该会话的 session 目录；返回空串表示成功，否则是错误说明。 */
    openSessionDirectory(conversationId: string): Promise<string>
    /** 重命名只改标题，不影响排序；返回改后的记录，标题为空时抛错。 */
    rename(conversationId: string, title: string): Promise<ConversationRecord | null>
    archive(conversationId: string): Promise<void>
    remove(conversationId: string): Promise<void>
    /** 清空会话全部消息与运行时状态，保留会话条目并重置标题。 */
    clear(conversationId: string): Promise<{ deleted: number }>
  }
  git: {
    /** 当前工作区 Git 状态；非仓库或读取失败返回 null。 */
    state(): Promise<GitWorkspaceState | null>
    /** 本地分支名列表。 */
    branches(): Promise<string[]>
    /** 切换到指定本地分支；失败返回错误信息。 */
    checkout(branch: string): Promise<GitOperationResult>
    /** 基于当前 HEAD 新建分支并切换过去；失败返回错误信息。 */
    create(name: string): Promise<GitOperationResult>
    /** 未提交变更列表（porcelain 摘要）。 */
    status(): Promise<GitStatusEntry[]>
    /** 工作区 .git 元数据变化（外部切换分支等）时通知，返回取消订阅函数。 */
    onChanged(listener: () => void): () => void
  }
  workspace: {
    pickRoot(): Promise<string | null>
    /** 传 null 表示离开工作区，之后 @ 补全与产物面板都不再指向旧项目。 */
    setRoot(path: string | null): Promise<string | null>
    /** 在当前项目根目录生成 AGENTS.md；没有已存在的记忆文件时不覆盖。 */
    initProject(options?: { force?: boolean }): Promise<InitProjectResult>
    snapshot(): Promise<WorkspaceSnapshot>
    /** 只读取工作区内的文本文件；越界路径、目录与二进制文件都会 reject。 */
    readFile(path: string): Promise<WorkspaceFileContent>
    /** 读取工作区内的图片并返回 base64 data URL，供预览面板展示。 */
    readImage(path: string): Promise<{ path: string; dataUrl: string }>
    /** 列出工作区内某一层目录，空串表示根目录；越界路径会 reject。 */
    listDirectory(path: string): Promise<WorkspaceListing>
    /** 输入框 @ 补全用的模糊文件搜索；未打开工作区会 reject。 */
    searchFiles(query: string): Promise<WorkspaceFileMatch[]>
    /** 在系统文件管理器中定位工作区内文件/目录（打开所在窗口并选中）；成功返回空串。 */
    reveal(path: string): Promise<string>
    /** 把工作区内相对路径解析成绝对路径（空串表示根目录）；越界路径会 reject。 */
    absolutePath(path: string): Promise<string>
    /** 用系统默认应用打开工作区内文件/目录；成功返回空串，失败返回错误信息。 */
    openExternal(path: string): Promise<string>
    /** 删除工作区内文件/目录（目录递归）；成功返回 { ok: true }，失败返回错误信息。 */
    delete(path: string): Promise<{ ok: boolean; error?: string }>
  }
  projects: {
    list(): Promise<ProjectRecord[]>
    listPage(query?: PageQuery): Promise<PageResult<ProjectRecord>>
    add(input: { path: string; name?: string }): Promise<ProjectRecord>
    archive(id: string): Promise<void>
    remove(id: string): Promise<void>
  }
  artifacts: {
    list(query?: ArtifactQuery): Promise<Artifact[]>
    /** 移除一条产物登记；只删记录，不动磁盘上的文件。 */
    remove(artifactId: string): Promise<void>
    /** Agent 产生新 Artifact（或更新）后广播，Artifacts 面板据此实时刷新。 */
    onChanged(listener: () => void): () => void
  }
  agentRuns: {
    /** 会话的运行台账（含每次 Sub-agent 委派），按开始时间倒序。 */
    list(conversationId: string, limit?: number): Promise<AgentRunLedgerEntry[]>
    listTasks(query: { runId?: string; conversationId?: string; turnId?: string; limit?: number }): Promise<AgentTaskRecord[]>
    /** 会话最近一次可续跑的中断运行；无可续跑时为 null。恢复由用户点击触发，不自动进行。 */
    resumable(conversationId: string): Promise<ResumableRun | null>
    /** 生成「继续上一轮」要送进模型的提示，由调用方作为普通消息发出。 */
    resumePrompt(runId: string): Promise<string | null>
  }
  memories: {
    /** 记忆管理页的分页列表；不传 status 时只列 active。 */
    list(query?: MemoryListQuery): Promise<PageResult<MemoryRecord>>
    update(id: string, patch: MemoryUpdateInput): Promise<MemoryRecord | null>
    /** 软删：记录保留但不再参与召回。 */
    remove(id: string): Promise<void>
    /** 物理清空某个作用域，返回删除条数；scope 缺省表示清空当前账户全部记忆。 */
    clear(scope?: MemoryScope, scopeId?: string | null): Promise<number>
    /** 抽取写入或用户编辑后广播，管理页据此刷新。 */
    onChanged(listener: () => void): () => void
  }
  changes: {
    /** 某一轮 Agent 对工作区的最终变更聚合；不含 diff 文本。 */
    list(turnId: string): Promise<AgentRunChanges>
    /** 单个文件在这一轮的逐行 diff；二进制 / 超大文件为 null。 */
    diff(turnId: string, path: string): Promise<string | null>
  }
  composer: {
    /** 把输入框内容写入临时草稿文件并用系统默认编辑器打开，返回草稿路径 */
    openExternalEditor(text: string): Promise<{ path: string }>
    /** 读回草稿内容并删除临时文件；文件不存在时返回 null */
    readExternalEditor(path: string): Promise<string | null>
  }
  quick: {
    /** 隐藏快速对话窗口（Esc / 失焦由主进程处理，这里是渲染进程主动隐藏入口） */
    hide(): Promise<void>
  }
  shell: {
    // 成功返回空串，失败返回系统给的错误信息
    openPath(path: string): Promise<string>
    /** 仅 http/https，其它协议返回错误信息且不会打开。 */
    openExternal(url: string): Promise<string>
  }
  onAuthState(listener: (snapshot: AuthSnapshot) => void): () => void
  onTrayNewConversation(listener: () => void): () => void
  onTrayHidden(listener: () => void): () => void
}
