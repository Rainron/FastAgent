import type { PermissionAction } from '../permission-rules'
import type { SandboxSettings } from '../sandbox'
import type { AgentAbilityPolicy } from './abilities'
import type { AppTheme, ContextStrategy, ConversationMode, ThinkingLevel } from './common'
import type { MemorySettings } from './memory'
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

export interface AppSettings {
  startAtLogin: boolean
  showOnStartup: boolean
  closeToTray: boolean
  theme: AppTheme
  autoSummary: boolean
  contextStrategy: ContextStrategy
  triggerRatio: number | null
  keepRecentTurns: number | null
  /** agent 模式使用的 shell 工具；Windows 默认 Git Bash，探测不到可用 bash 时自动改用 PowerShell */
  shellPreference: 'bash' | 'powershell'
  /** 显式指定的 bash 路径（如 Git Bash / MSYS2 的 bash.exe）；空串表示自动探测 */
  bashPath: string
  /** Ctrl+G 外部编辑使用的编辑器可执行文件路径；空串表示用系统默认应用打开草稿 */
  externalEditorPath: string
  /** Agent 可发现的能力范围；当前只实现 all_enabled 分支 */
  agentAbilityPolicy: AgentAbilityPolicy
  /** 是否启用只读 Sub-agent；关闭后主 Agent 不会获得委派工具。 */
  subAgentEnabled: boolean
  /** 用户定义的只读 Sub-agent 角色，写入能力由后续阶段单独开放。 */
  subAgents?: Array<{ id: string; name: string; description: string; systemPrompt: string; thinkingLevel?: ThinkingLevel; maxTurns?: number }>
  /** 跨会话长期记忆；关闭后既不召回也不抽取 */
  memory: MemorySettings
  /** Agent 命令执行的 OS 级沙箱设置 */
  sandbox: SandboxSettings
  /** 全局连按两次 Ctrl 唤起快速对话；关闭后卸载键盘钩子 */
  quickDialogEnabled: boolean
  /** 快捷键绑定；缺省字段视为未绑定 */
  shortcuts?: ShortcutSettings
}
