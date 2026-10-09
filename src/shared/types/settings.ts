import type { PermissionAction } from '../permission-rules'
import type { SandboxSettings } from '../sandbox'
import type { AgentAbilityPolicy } from './abilities'
import type { AppTheme, ContextStrategy, ConversationMode, ThinkingLevel } from './common'
import type { MemorySettings } from './memory'
import type { ShellCommandSettings } from './shell-command'
import type { TraceDisplaySettings } from './trace-display'
import type { ShortcutSettings } from './shortcuts'

export interface StoredPermissionRule {
  toolKey: string
  pattern: string
  action: PermissionAction
  updatedAt: string
}

/** 应用级运行与上下文偏好，持久化于本地 SQLite。 */
export interface ClientPreferences {
  recentServers: string[]
  favoriteModelIds: number[]
  recentModelIds: number[]
  selectedModelId: number | null
  modePrompts: Partial<Record<ConversationMode, string>>
  sidebarSections: {
    workspace: boolean
    recent: boolean
  }
  paginationPageSize: number
  gitChangeView: {
    mode: 'file' | 'folder' | 'status'
    collapsedDirs: string[]
  }
}

export interface DataStorageInfo {
  dataRoot: string
  databasePath: string
  cacheDir: string
  logsDir: string
  tempDir: string
  sessionsDir: string
  agentDir: string
  skillsDir: string
  mcpDir: string
  pluginsDir: string
  attachmentsDir: string
  backupsDir: string
  exportsDir: string
  defaultRoot: string
  isDefault: boolean
}

export interface AppRuntimeInfo {
  version: string
  electron: string
  node: string
  chrome: string
  platform: string
  dataRoot: string
  backendUrl: string | null
}

/** 启动阶段：与主进程真实初始化步骤一一对应，不做无对应工作的展示性阶段。 */
export type StartupPhase = 'config' | 'abilities' | 'interface' | 'workspace' | 'ready'

/** 启动页信息密度：启动够快时只露 Logo，久了才逐级给出真实状态。 */
export type SplashVerbosity = 'minimal' | 'status' | 'slow'

/** 主进程推给启动页的唯一数据形态；启动页自身不判断任何时序。 */
export interface SplashUpdate {
  phase: StartupPhase
  label: string
  verbosity: SplashVerbosity
  /** 设置里主题为显式 light/dark 时下发，覆盖启动页默认跟随系统的行为。 */
  theme?: 'light' | 'dark'
}

/** 启动期的非致命失败：不阻塞进入主界面，进入后以提示条呈现。 */
export interface StartupWarning {
  scope: string
  message: string
}

export interface StartupWarnings {
  warnings: StartupWarning[]
  logPath: string
}

/** 渲染进程未捕获异常的上报载荷；主进程收到后按崩溃报告落盘。 */
export interface RendererErrorReport {
  message: string
  stack?: string | null
  componentStack?: string | null
  /** 界面已经画出来之后才出错，与首屏挂掉的成因往往不同，分开标注。 */
  afterPaint?: boolean
}

export type MotionPreference = 'system' | 'on' | 'off'

/** 外观强调色预设；四值分别对应 --accent/--accent-2/--accent-soft/--accent-line */
export type AccentColorKey = 'green' | 'terracotta' | 'blue' | 'purple' | 'graphite'

/** 基础字号档位；渲染层换算为全局缩放 */
export type BaseFontSize = 'small' | 'medium' | 'large'

/** 界面密度；紧凑档降低列表行高与内边距 */
export type UiDensity = 'comfortable' | 'compact'

/** 底色明度档位；整条 canvas/sidebar/surface 阶梯一起平移。dim 更沉、bright 更亮，两套主题同向 */
export type SurfaceLevel = 'dim' | 'standard' | 'bright'

/** 对话正文（--text-body）与底色的对比强度；深色下 strong 更亮，浅色下 strong 更暗 */
export type BodyTextContrast = 'soft' | 'standard' | 'strong'

/**
 * 运行上限。三项都作用在真实存在的机制上：
 * 并发上限交给 RunScheduler，两项重试上限交给 pi 运行时的自动重试，
 * 会话预算在开跑前按已记录的 token 用量拦截。
 */
export interface RunLimits {
  /** 同时进行的运行数上限，1~16。 */
  maxConcurrentRuns: number
  /** 单次运行内「空响应自动重试」的次数上限，0 表示不重试。 */
  maxEmptyRetries: number
  /** 单次运行内「输出达上限自动续写」的次数上限，0 表示不续写。 */
  maxLengthContinuations: number
  /** 单个会话累计 token 预算；null 表示不限制。达到后拒绝开新一轮。 */
  conversationTokenBudget: number | null
}

export interface AppSettings {
  motionPreference: MotionPreference
  startAtLogin: boolean
  showOnStartup: boolean
  closeToTray: boolean
  theme: AppTheme
  accentColor: AccentColorKey
  baseFontSize: BaseFontSize
  uiDensity: UiDensity
  surfaceLevel: SurfaceLevel
  bodyTextContrast: BodyTextContrast
  sidebarGlass: boolean
  /**
   * 侧栏会话标题最多显示多少个字；超出的部分鼠标悬停时自右向左滚出来。
   * 缺省视为默认值（见 SIDEBAR_TITLE_CHARS）。
   */
  sidebarTitleChars?: number
  autoSummary: boolean
  contextStrategy: ContextStrategy
  triggerRatio: number | null
  /** 仅作用于跨 provider 换模型时的回合摘要；常规压缩由 Pi 在会话内按 token 保留。 */
  keepRecentTurns: number | null
  /**
   * 越过触发点但常规压缩压不动时，是否降级强压。
   *
   * Pi 的会话内压缩只摘要「保留区之外」的消息，保留区之外没东西可摘时它静默什么都不做，
   * 会话会一直贴在红线上直到溢出。打开后按两级降级：先收缩保留区重压，仍不行就按应用回合
   * 切摘要并重开 session。代价是丢掉更多近期原文，所以默认关闭。
   */
  forceCompaction: boolean
  /** agent 模式使用的 shell 工具；Windows 默认 Git Bash，探测不到可用 bash 时自动改用 PowerShell */
  shellPreference: 'bash' | 'powershell'
  /** 显式指定的 bash 路径（如 Git Bash / MSYS2 的 bash.exe）；空串表示自动探测 */
  bashPath: string
  /** 执行轨迹的展示偏好；缺省视为默认值（底部用时 + 中文文案 + 展开即见内容） */
  traceDisplay?: TraceDisplaySettings
  /** 输入框 `!命令` 直接执行 shell；缺省视为默认值（开启 + 只本地显示） */
  shellCommand?: ShellCommandSettings
  /** Ctrl+G 外部编辑使用的编辑器可执行文件路径；空串表示用系统默认应用打开草稿 */
  externalEditorPath: string
  /** Agent 可发现的能力范围；当前只实现 all_enabled 分支 */
  agentAbilityPolicy: AgentAbilityPolicy
  /** 是否启用只读 Sub-agent；关闭后主 Agent 不会获得委派工具。 */
  subAgentEnabled: boolean
  /**
   * 单个子任务允许的工具调用次数上限。
   *
   * pi 的轮次循环在 `session.prompt()` 内部，SDK 不提供轮次上限，工具调用次数是唯一能观测到的边界。
   * 角色自己声明了 `maxToolCalls` 时以角色的为准，这里是其余角色共用的默认值。
   */
  subAgentMaxToolCalls: number
  /**
   * 用户定义的只读 Sub-agent 角色，写入能力由后续阶段单独开放。
   *
   * `maxTurns` 是历史字段：轮次从来没有传给子运行，填多少都不生效，已由 `maxToolCalls` 取代。
   * 保留声明只为读旧配置，不再写入。
   */
  subAgents?: Array<{ id: string; name: string; description: string; systemPrompt: string; thinkingLevel?: ThinkingLevel; maxToolCalls?: number; maxTurns?: number }>
  /** 跨会话长期记忆；关闭后既不召回也不抽取 */
  memory: MemorySettings
  /** Agent 命令执行的 OS 级沙箱设置 */
  sandbox: SandboxSettings
  /** 全局连按两次 Ctrl 唤起快速对话；关闭后卸载键盘钩子 */
  quickDialogEnabled: boolean
  /** 快捷键绑定；缺省字段视为未绑定 */
  shortcuts?: ShortcutSettings
  /** 运行上限：达到后进入明确的失败/排队状态并说明原因，不静默继续。 */
  limits: RunLimits
  attachmentMaxFileSizeMb: number
  attachmentMaxImageSizeMb: number
  attachmentFileExtensions: string[]
  attachmentImageExtensions: string[]
}
