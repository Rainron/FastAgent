import type { Attachment, ContextPolicy, ConversationMode, GitOperationResult, GitWorkspaceState, ModelOption, PermissionPreset, ShortcutSettings, ThinkingLevel } from '../../shared/types'
import type { PermissionProfile } from '../../shared/permission-profiles'
import type { CompactionState } from '../conversation/compaction-state'
import type { ContextHealthData } from '../conversation/ContextHealth'
import type { QueuedPrompt } from '../conversation/prompt-queue'
import type { WorkspaceConversation } from '../workspace/workspace-types'
import type { ProjectTrustState } from './WorkspaceMenu'

export interface ComposerModeProps {
  mode: ConversationMode
  /** 计划模式开启时显示 Plan 标记，回复只产出实施计划。 */
  planMode: boolean
  onTogglePlanMode: () => void
  /** Agent 仅在项目会话可用；快速对话固定 chat。 */
  agentAvailable: boolean
  setMode: (mode: ConversationMode) => void
}

export interface ComposerModelProps {
  model: ModelOption | null
  selectedModelId: number | null
  models: ModelOption[]
  favoriteModelIds: number[]
  recentModelIds: number[]
  onSelectModel: (modelId: number) => void
  onToggleFavorite: (modelId: number) => void
  thinkingLevel: ThinkingLevel
  onThinkingLevelChange: (level: ThinkingLevel) => void
  onManageModels: () => void
}

export interface ComposerPermissionProps {
  permission: PermissionPreset | null
  /** 可选档位，内置三档恒在最前。 */
  permissionProfiles: PermissionProfile[]
  onPermissionChange: (preset: PermissionPreset) => void
  /** 打开设置页的「Agent 执行权限」分区。 */
  onOpenPermissionSettings: () => void
}

export interface ComposerRunProps {
  runId: string | null
  queue: QueuedPrompt[]
  onEnqueue: (text: string, attachments: Attachment[]) => void
  onRemoveQueued: (id: string) => void
  onSend: (text: string, attachments: Attachment[]) => Promise<void>
  onCancel: () => void
  /** 已请求暂停：按钮切成继续，提示区说明生效边界。 */
  paused: boolean
  onPause: () => void
  onResume: () => void
}

export interface ComposerContextProps {
  contextHealth: ContextHealthData
  /** 这条会话实际生效的压缩策略；上下文环的刻度与配色都由它决定。 */
  contextPolicy: Pick<ContextPolicy, 'strategy' | 'autoSummary' | 'triggerRatio'> | null
  compaction: CompactionState | null
  onCompact: () => void
  onCancelCompaction?: () => void
  /** 打开会话详情的压缩历史。 */
  onOpenCompactionHistory?: () => void
}

export interface ComposerCommandProps {
  onNewChat: () => void
  onSelectConversation: (item: WorkspaceConversation) => void
  onClearConversation: () => Promise<void>
  onInitProject: () => Promise<void>
  /** `!命令`：直接执行 shell，不发给模型。设置里关掉时为 undefined，`!` 当普通文本。 */
  onRunShellCommand?: (command: string) => void
  /** /resume 的语境依据：当前选中项目 id，null 表示快速对话，列表按它过滤。 */
  currentProjectId: string | null
}

export interface ComposerWorkspaceProps {
  /** 输入框上方上下文条里的项目；null（快速对话）时没有项目入口，再没有 Git 状态整条就不渲染。 */
  workspace: { name: string; path: string } | null
  onRevealWorkspace: () => void
  onCopyWorkspacePath: () => void
  onChangeWorkspace: () => void
  onOpenWorkspaceTerminal: () => void
  /** Project Trust：项目指令文件信任状态与切换；null 时不展示入口。 */
  workspaceTrust?: ProjectTrustState | null
  onToggleWorkspaceTrust?: (trusted: boolean) => void
}

export interface ComposerGitProps {
  /** Git 分支展示与切换；null 时不渲染入口。 */
  gitState: GitWorkspaceState | null
  gitAnyRunActive: boolean
  onGitCheckout: (branch: string) => Promise<GitOperationResult>
  onGitCreate: (name: string) => Promise<GitOperationResult>
  onGitStopAndCheckout: (branch: string) => Promise<GitOperationResult>
}

export interface ComposerLayoutProps {
  height: number
  heightPinned: boolean
  onHeightChange: (height: number, pinned: boolean) => void
  /** 输入框作用域的快捷键绑定，未设置时回落 DEFAULT_IN_APP_BINDINGS。 */
  shortcuts: ShortcutSettings | undefined
}

export interface ComposerRequestProps {
  attachmentRequest: number
  quoteRequest: { text: string; nonce: number } | null
  /** 直接写进输入框的提示（成果「继续修改」），不加引用块。 */
  prefillRequest: { text: string; nonce: number } | null
  onNotice: (notice: string) => void
}

export type ComposerProps =
  ComposerModeProps
  & ComposerModelProps
  & ComposerPermissionProps
  & ComposerRunProps
  & ComposerContextProps
  & ComposerCommandProps
  & ComposerWorkspaceProps
  & ComposerGitProps
  & ComposerLayoutProps
  & ComposerRequestProps
