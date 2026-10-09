import type { PermissionProfile, StoredPermissionProfile } from '../permission-profiles'
import type { PermissionAction } from '../permission-rules'
import type { ModelParameterOverride } from '../model-parameters'
import type { Ability, AbilityType, DoctorReport, LocalMcpServer, LocalMcpServerInput, LocalSkillRecord, McpPromptDescriptor, McpPromptResult, McpResourceContent, McpResourceDescriptor, McpResourceTemplateDescriptor, McpServerDetail, McpTestStatus, SkillCheckResult, SkillDetail, SkillDraft, SkillVersionRecord } from './abilities'
import type { BundleExportOptions, BundleImportPlan, BundlePreview } from './bundle'
import type { HubInstallResult, HubInstalledAbility, HubListingDetail, HubQuery, HubSearchResult, HubSource, HubSourceInput, HubUpdateCheckResult } from './hub'
import type { AgentEvent, ToolCallRecord } from './agent-events'
import type { AgentRunChanges, FileVersionRecord, TurnRevertResult } from './changes'
import type { ActiveRunInfo, AgentRunLedgerEntry, AgentTaskRecord, ResumableRun } from './agent-runs'
import type { AuthSnapshot, BootstrapData, CaptchaData } from './auth'
import type { ApprovalDecision, ApprovalRequest, ConversationMode, ConversationRunState, PermissionPreset, ThinkingLevel, TodoItem } from './common'
import type { CompactionHistory, ContextPolicy, ContextState, ContextSummary, ModelUsageOverview, ModelUsageSummary, ModelUsageWindow, TurnContextSource } from './context'
import type { Attachment, ConversationDetailed, ConversationInspector, ConversationPageQuery, ConversationRecord, ConversationStats, ConversationTurn, ConversationTurnPatch } from './conversation'
import type { MemoryListQuery, MemoryRecord, MemoryScope, MemoryTurnActivity, MemoryUpdateInput } from './memory'
import type { LocalModelSummary, LocalModelTestResult } from './models'
import type { ModelConnectionsApi } from './model-connections'
import type { PageQuery, PageResult, Plugin, PluginDetail, PluginInstallResult, PluginQuery } from './plugins'
import type { RuntimeReport } from './runtime'
import type { SandboxCapabilities, SandboxSessionInfo } from './sandbox'
import type { SearchQuery, SearchResponse } from './search'
import type { ShellCommandChunk, ShellCommandRequest, ShellCommandResult } from './shell-command'
import type { TerminalAttachment, TerminalChunk, TerminalExit, TerminalSessionInfo } from './terminal'
import type { AppRuntimeInfo, AppSettings, ClientPreferences, DataStorageInfo, RendererErrorReport, StartupWarnings, StoredPermissionRule } from './settings'
import type { KbEntry, KbIndexResult, KbSource, KbSourceKind, KbSourcePreview } from './kb'
import type { Artifact, ArtifactQuery, GitBranchInfo, GitCommitDetail, GitCommitSummary, GitIntegrationState, GitOperationResult, GitRemoteInfo, GitStashEntry, GitStatusEntry, GitWorkingChanges, GitWorkspaceState, InitProjectResult, ProjectRecord, WorkspaceFileContent, WorkspaceFileMatch, WorkspaceListing, WorkspaceSnapshot } from './workspace'

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
    /** 读取附件图片转 data URL；路径失效或超出限制时返回 null，不抛错。 */
    readImage(path: string): Promise<string | null>
    saveClipboardImage(dataUrl: string, name: string, type: string): Promise<string>
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
  /** 自绘标题栏的窗口控制；系统按钮已关闭，最小化/最大化/关闭全部经由这里。 */
  window: {
    minimize(): Promise<void>
    /** 返回切换之后的最大化状态。 */
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizedChange(listener: (maximized: boolean) => void): () => void
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
    requestLogin(): Promise<AuthSnapshot>
    enterWorkspace(modelId?: number): Promise<AuthSnapshot>
  }
  resources: {
    bootstrap(): Promise<BootstrapData>
  }
  models: {
    localList(): Promise<LocalModelSummary[]>
    onChanged(listener: () => void): () => void
    /** 模型对话连通性测试：云端账号 / 本地服务连接 / 旧版独立本地模型按 id 通用，发送短对话校验真实回复。 */
    testDialogue(id: number): Promise<LocalModelTestResult>
    /**
     * 云端模型的本地参数覆盖。key 是 `provider\tmodel_name`，覆盖永远优先于云端下发值。
     * 连接内模型不走这里——它们的参数直接存在自己的配置里。
     */
    listOverrides(): Promise<Array<{ key: string; override: ModelParameterOverride }>>
    /** 传空对象即清除该模型的全部覆盖。 */
    setOverride(provider: string, modelName: string, override: ModelParameterOverride): Promise<ModelParameterOverride>
  }
  modelConnections: ModelConnectionsApi
  doctor: {
    /** 跑一次环境体检：开发工具、Shell、沙箱、工作区、能力。只探测与报缺，不做任何安装。 */
    run(): Promise<DoctorReport>
    /** 导出诊断信息到文件；内容按白名单挑字段，不含后端地址、本机路径与凭据。取消时返回 null。 */
    export(): Promise<string | null>
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
    /** 从会话蒸馏 SKILL.md 草稿：只返草稿不落库，确认后走 create。 */
    distill(conversationId: string, modelId: number | null): Promise<SkillDraft>
    /** 历史版本：每次改写 SKILL.md 之前存下的旧内容，按修订号倒序。 */
    versions(name: string): Promise<SkillVersionRecord[]>
    /** 回退到指定修订；当前内容会先存成新快照，可以再退回来。 */
    revert(name: string, revision: number): Promise<LocalSkillRecord>
    /** 静态校验：只查配置与工具依赖，不启动模型也不执行脚本。 */
    check(name: string): Promise<SkillCheckResult>
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
    /** 读取已连接 Server 的资源清单；服务端不支持时返回空数组和诊断信息。 */
    resources(id: string): Promise<{ resources: McpResourceDescriptor[]; templates: McpResourceTemplateDescriptor[] }>
    /** 读取指定 MCP resource；仅允许读取已保存且启用的 Server。 */
    readResource(id: string, uri: string): Promise<{ contents: McpResourceContent[] }>
    /** 获取指定 MCP prompt 模板和展开后的消息。 */
    prompts(id: string): Promise<{ prompts: McpPromptDescriptor[] }>
    getPrompt(id: string, name: string, args?: Record<string, string>): Promise<McpPromptResult>
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
    /**
     * 快速对话专用通道。chat 模式直接调模型接口，不走 pi 运行时，无工具 / MCP / 权限审批；
     * mode 传 agent 时改走与主窗口相同的运行时（工具、沙箱、审批齐全），未绑定项目则用快速工作区。
     */
    quickSend(input: { conversationId: string; prompt: string; modelId: number | null; thinkingLevel: ThinkingLevel; mode?: ConversationMode; permission?: PermissionPreset | null }): Promise<{ runId: string; turnId: string; turn: ConversationTurn }>
    /** 取消当前 run；返回未投递的插队消息，渲染层据此把文字还给输入框。 */
    cancel(runId: string): Promise<{ pending: string[] }>
    /**
     * 运行中插队：消息在当前这一步工具跑完、下一次调模型之前进入同一轮上下文。
     * delivered=false 表示这一轮拿不到会话运行时（还在初始化或走直连快问通道），
     * 调用方要退回本地排队。
     */
    steer(input: { runId: string; conversationId: string; text: string; attachments: Attachment[] }): Promise<{ delivered: boolean }>
    /**
     * 暂停：在下一次工具调用前停住。已经发出的模型请求与正在执行的工具不受影响，
     * 因此按下之后可能还会看到当前这一步跑完。run 已结束时返回 false。
     */
    pause(runId: string): Promise<boolean>
    /** 继续执行；该 run 没有处于暂停状态时返回 false。 */
    resume(runId: string): Promise<boolean>
    /** 运行途中改权限档位：立刻对当前这一轮生效；run 已结束时返回 false。 */
    setPermission(runId: string, preset: PermissionPreset | null): Promise<boolean>
    respondApproval(id: string, decision: ApprovalDecision, answer: string | undefined, runId: string): Promise<void>
    onEvent(listener: (event: AgentEvent) => void): () => void
    listStates(): Promise<ConversationRunState[]>
    /** 主进程里仍在跑的 run；界面重载后靠它接回运行中的会话与回合。 */
    listActive(): Promise<ActiveRunInfo[]>
    /** 仍在等答复的审批与提问；界面重载后靠它把弹层重新挂回来，否则整轮会一直停着。 */
    listPendingApprovals(): Promise<Array<{ runId: string; request: ApprovalRequest; conversationId: string | null }>>
    saveState(state: ConversationRunState): Promise<void>
    markRead(conversationId: string): Promise<void>
  }
  usage: {
    /** 跨会话用量聚合；给天数时主进程夹到 1..365，给日期区间时按本地日期闭区间统计。 */
    overview(window: ModelUsageWindow): Promise<ModelUsageOverview>
  },
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
    /** 本轮实际注入的知识条目 / Skill / 规则文件；记忆走 memories.turnActivity。 */
    contextSources(turnId: string): Promise<TurnContextSource[]>
    /** 哪些回合有上下文来源记录；会话加载时一次拉全。 */
    contextSourceTurns(conversationId: string): Promise<string[]>
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
    /** 弹保存对话框把会话导出为 Markdown / HTML（由对话框过滤器决定）；取消时返回 null，否则返回落地路径。 */
    export(conversationId: string): Promise<string | null>
    archive(conversationId: string): Promise<void>
    remove(conversationId: string): Promise<void>
    /** 清空会话全部消息与运行时状态，保留会话条目并重置标题。 */
    /**
     * 彻底清空一个会话：消息、上下文、运行台账、成果登记、附件副本、Agent session 文件，
     * 以及由这个会话抽出的记忆。会话条目保留并把标题重置为「新对话」。不可撤销。
     */
    clear(conversationId: string): Promise<{ deleted: number; turns: number; runs: number; artifacts: number; memories: number }>
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
    /** 本地分支详情（含 upstream 与领先/落后条数）。 */
    branchInfos(): Promise<GitBranchInfo[]>
    /** 远程跟踪分支名（origin/main 形式）。 */
    remoteBranches(): Promise<string[]>
    /** 远程名列表。 */
    remotes(): Promise<string[]>
    remoteDetails(): Promise<GitRemoteInfo[]>
    addRemote(name: string, url: string): Promise<GitOperationResult>
    setRemoteUrl(name: string, url: string): Promise<GitOperationResult>
    removeRemote(name: string): Promise<GitOperationResult>
    /** 工作区改动，按已暂存 / 未暂存分组。 */
    changes(): Promise<GitWorkingChanges>
    /** 合并 / 变基进行中状态与冲突文件。 */
    integration(): Promise<GitIntegrationState>
    /** 指定 ref 的提交列表；ref 传空取 HEAD。 */
    commits(ref: string, limit?: number, skip?: number): Promise<GitCommitSummary[]>
    commitCount(ref: string): Promise<number>
    /** 单条提交的完整信息；哈希无效时返回 null。 */
    commitDetail(hash: string): Promise<GitCommitDetail | null>
    /** 提交的 patch；带 path 时只取该文件。 */
    commitPatch(hash: string, path?: string | null): Promise<string>
    /** 工作区文件 diff；staged 取暂存区与 HEAD 的差异，untracked 取新文件全文。 */
    fileDiff(path: string, staged: boolean, untracked?: boolean): Promise<string>
    /** 全部未提交改动的合并 diff。 */
    workingDiff(stagedOnly?: boolean): Promise<string>
    stashes(): Promise<GitStashEntry[]>
    stashPatch(ref: string): Promise<string>
    /** 基于远程分支建立本地跟踪分支并切换过去。 */
    createTracking(remoteRef: string, localName?: string): Promise<GitOperationResult>
    /** 删除本地分支；未合并时返回 needsForce，由 UI 二次确认后带 force 重试。 */
    deleteBranch(name: string, force?: boolean): Promise<GitOperationResult>
    renameBranch(from: string, to: string): Promise<GitOperationResult>
    /** remoteRef 传 null 表示取消跟踪。 */
    setUpstream(branch: string, remoteRef: string | null): Promise<GitOperationResult>
    stage(paths: string[]): Promise<GitOperationResult>
    unstage(paths: string[]): Promise<GitOperationResult>
    commit(message: string, options?: { amend?: boolean }): Promise<GitOperationResult>
    /** 丢弃改动：paths 是已跟踪文件，untracked 是要删除的未跟踪文件。不可恢复。 */
    discard(paths: string[], untracked?: string[]): Promise<GitOperationResult>
    /** 回退最近一次提交，soft 保留暂存，mixed 只保留工作区改动。 */
    reset(mode: 'soft' | 'mixed'): Promise<GitOperationResult>
    fetch(remote?: string): Promise<GitOperationResult>
    /** 只做快进；无法快进时报错，由用户显式走 merge / rebase。 */
    pull(): Promise<GitOperationResult>
    /** 没有 upstream 时自动 -u 建立跟踪；不支持强推。 */
    push(remote?: string): Promise<GitOperationResult>
    stashPush(message: string, includeUntracked?: boolean): Promise<GitOperationResult>
    stashPop(ref: string): Promise<GitOperationResult>
    stashApply(ref: string): Promise<GitOperationResult>
    stashDrop(ref: string): Promise<GitOperationResult>
    /** 合并指定分支到当前分支；冲突时 conflicts 带回冲突文件。 */
    merge(ref: string): Promise<GitOperationResult>
    /** 把当前分支变基到指定分支；冲突时停在冲突状态。 */
    rebase(ref: string): Promise<GitOperationResult>
    abortIntegration(): Promise<GitOperationResult>
    /** 在系统终端打开工作区目录。 */
    openTerminal(): Promise<{ ok: boolean; error?: string }>
    /** 按当前未提交改动生成提交信息；modelId 用当前会话选中的模型。 */
    suggestCommitMessage(modelId?: number | null): Promise<{ message: string | null; error?: string }>
    /** 工作区 .git 元数据变化（外部切换分支等）时通知，返回取消订阅函数。 */
    onChanged(listener: () => void): () => void
  }
  workspace: {
    /** 在项目根目录打开系统终端窗口（Windows 优先 wt.exe，退回 cmd start）。 */
    openTerminal(): Promise<string>
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
    /** 工作区内是否存在这个文件（目录返回 false）；越界或未打开工作区返回 false，不抛错。 */
    exists(path: string): Promise<boolean>
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
    /** 刷新 updated_at，把项目顶到侧栏工作区列表最前；项目已删除时返回 null。 */
    touch(id: string): Promise<ProjectRecord | null>
    archive(id: string): Promise<void>
    remove(id: string): Promise<void>
    /** 项目指令文件（AGENTS/CLAUDE）信任状态；没探到指令文件时不值得展示信任入口。 */
    trustStatus(path: string): Promise<{ trusted: boolean; hasAgentContextFiles: boolean }>
    /** 信任/撤销信任；信任变更后下一轮 Agent 运行重建运行时并重新注入指令。 */
    setTrust(path: string, trusted: boolean): Promise<{ trusted: boolean }>
  }
  search: {
    /** 统一搜索：会话标题、项目知识、Skill、成果。Skill 是全局能力，按项目过滤时不参与。 */
    query(input: SearchQuery): Promise<SearchResponse>
  }
  knowledgeBase: {
    /** 项目知识条目列表；项目侧栏管理入口用。 */
    list(projectId: string): Promise<KbEntry[]>
    save(projectId: string, input: { id?: string; title: string; content: string }): Promise<KbEntry>
    remove(projectId: string, entryId: string): Promise<void>
    /** 项目下的文件/目录来源；界面据此展示索引状态与失败原因。 */
    listSources(projectId: string): Promise<KbSource[]>
    /** 弹系统对话框选路径并返回范围预览；用户取消时返回 null，此时未写库。 */
    pickSource(kind: KbSourceKind): Promise<KbSourcePreview | null>
    /** 对已知路径重算范围预览，用于调整排除规则后再看一眼。 */
    previewSource(path: string, kind: KbSourceKind, excludes?: string[]): Promise<KbSourcePreview>
    /** 建来源并立即索引；返回本次索引结果（含逐文件失败原因）。 */
    addSource(projectId: string, input: { path: string; kind: KbSourceKind; title?: string; excludes?: string[] }): Promise<KbIndexResult>
    /** 重新索引：按内容哈希增量更新，来源路径已消失时标记为 stale。 */
    refreshSource(sourceId: string): Promise<KbIndexResult>
    /** 解绑来源并删除它产生的全部条目。 */
    removeSource(sourceId: string): Promise<void>
    /** 保存/删除后广播，常开的编辑器据此刷新。 */
    onChanged(listener: (projectId: string) => void): () => void
  }
  artifacts: {
    list(query?: ArtifactQuery): Promise<Artifact[]>
    /** 移除一条产物登记；只删记录，不动磁盘上的文件。 */
    remove(artifactId: string): Promise<void>
    /** 成果的改动历史：一条记录对应一个改过它的回合，按时间倒序。 */
    versions(artifactId: string): Promise<FileVersionRecord[]>
    /** 某一次改动的逐行 diff；二进制与超大文件为 null。 */
    versionDiff(artifactId: string, turnId: string): Promise<string | null>
    /** 恢复到该回合改动之前的内容；恢复本身也记为一次新变更，可再退回。 */
    restore(artifactId: string, turnId: string): Promise<{ ok: boolean; error?: string }>
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
    /** 会话内闭环：某一轮的召回命中与提取产出，展开时才调用。 */
    turnActivity(turnId: string): Promise<MemoryTurnActivity>
    /** 哪些回合有记忆活动（召回命中或提取产出）；会话加载时一次拉全。 */
    conversationActivity(conversationId: string): Promise<string[]>
  }
  changes: {
    /** 某一轮 Agent 对工作区的最终变更聚合；不含 diff 文本。 */
    list(turnId: string): Promise<AgentRunChanges>
    /** 单个文件在这一轮的逐行 diff；二进制 / 超大文件为 null。 */
    diff(turnId: string, path: string): Promise<string | null>
    /** 撤销这一轮的文件改动：写回改动前原文、删掉本轮新建的文件；之后又被改过的文件跳过。 */
    revert(turnId: string): Promise<TurnRevertResult>
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
    /** 钉住小窗：agent 运行与待审批期间失焦不隐藏，否则审批无处可点 */
    setPinned(pinned: boolean): Promise<void>
  }
  shell: {
    // 成功返回空串，失败返回系统给的错误信息
    openPath(path: string): Promise<string>
    /** 仅 http/https，其它协议返回错误信息且不会打开。 */
    openExternal(url: string): Promise<string>
    /**
     * 输入框 `!命令`：在工作区根目录执行一条命令并等它退出。
     * 会话有活跃运行时复用其沙箱会话，命令与 agent 的 shell 工具落在同一隔离环境。
     */
    runCommand(input: ShellCommandRequest & { conversationId?: string | null }): Promise<ShellCommandResult>
    /** 终止仍在跑的 `!` 命令；命令已结束时返回 false。 */
    cancelCommand(id: string): Promise<boolean>
    /** `!` 命令的增量输出，返回取消订阅函数。 */
    onCommandOutput(listener: (payload: ShellCommandChunk) => void): () => void
  }
  terminal: {
    /** 仍活着的终端会话；面板重新挂载时靠它接回原来的 shell。 */
    list(): Promise<TerminalSessionInfo[]>
    /** 在当前工作区开一个新 shell；工作区未打开时落在用户主目录。 */
    create(options?: { cols?: number; rows?: number }): Promise<TerminalSessionInfo>
    /** 取回会话与断开期间缓冲的输出；会话已结束时返回 null。 */
    attach(id: string): Promise<TerminalAttachment | null>
    write(id: string, data: string): Promise<void>
    resize(id: string, cols: number, rows: number): Promise<void>
    /** 结束会话；会话本就不在时返回 false。 */
    close(id: string): Promise<boolean>
    onData(listener: (chunk: TerminalChunk) => void): () => void
    onExit(listener: (event: TerminalExit) => void): () => void
  }
  onAuthState(listener: (snapshot: AuthSnapshot) => void): () => void
  onTrayNewConversation(listener: () => void): () => void
  onTrayHidden(listener: () => void): () => void
}
