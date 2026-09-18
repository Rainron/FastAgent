export type ConversationMode = 'chat' | 'agent'
export type ModelThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ThinkingLevel = 'auto' | ModelThinkingLevel
export type ThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>
/**
 * 权限档位标识。内置三档是 'ask' | 'workspace' | 'full'，用户自定义档位是自己的 slug，
 * 所以这里是开放字符串；内置档的判定用 shared/permission-profiles 的 isBuiltinPreset。
 */
export type PermissionPreset = string
export type AppTheme = 'system' | 'light' | 'dark'
export type ContextStrategy = 'auto' | 'conservative' | 'aggressive' | 'disabled'

export type ApprovalDecision = 'reject' | 'once' | 'session' | 'always'

export type RunStatus = 'idle' | 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled'

export interface ConversationRunState {
  conversationId: string
  projectId: string | null
  status: RunStatus
  hasUnreadResult: boolean
  updatedAt: number
}

/** 挂起到渲染进程的审批/提问请求；respondApproval 按 id 结算。 */
export interface ApprovalRequest {
  id: string
  kind: 'permission' | 'doom_loop' | 'question'
  tool: string
  subject: string
  cwd: string
  risk: boolean
  subAgent?: { id: string; taskId: string; parentToolCallId: string }
  /** 选「本次会话允许 / 始终允许」后实际生效的规则模式，界面据此说明授权范围 */
  scopePatterns?: string[]
  /** question 种类携带问题列表；doom_loop 携带提示选项 */
  options?: unknown
}

/** 问题交互形式；缺省时按是否有 options 推断（有 → single-select，无 → text） */
export type QuestionType = 'single-select' | 'multi-select' | 'text' | 'textarea'

/** 结构化选项；Agent 也可以直接给字符串，界面层统一归一化 */
export interface QuestionOption {
  title: string
  description?: string
  recommended?: boolean
}

export interface QuestionItem {
  id: string
  title: string
  question: string
  type?: QuestionType
  /** 是否必答；默认 true */
  required?: boolean
  options?: (string | QuestionOption)[]
}

export interface QuestionAnswer {
  id: string
  answer: string
}

/**
 * blocked / failed / skipped 是后加的三态。此前模型只能把「被外部条件挡住」「执行失败」
 * 「主动放弃」全部塞进 cancelled，Plan 面板因此分不出待处理与已放弃。
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'blocked' | 'failed' | 'skipped'

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
  position?: number
  /** 所属阶段名。缺省表示不分组，Plan 面板回退到扁平列表。 */
  phase?: string
  /** 阶段之间的排序，按阶段名首次出现顺序分配。 */
  phasePosition?: number
  /** 委派给 Sub-agent 时记下 agent_tasks.task_id。 */
  delegatedTaskId?: string
}
