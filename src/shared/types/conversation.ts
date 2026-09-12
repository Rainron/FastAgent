import type { AgentEvent, ExecutionSnapshot } from './agent-events'
import type { ConversationMode, PermissionPreset, ThinkingLevel } from './common'
import type { CompactionHistory, ContextPolicy, ContextState, ContextSummary } from './context'
import type { PageQuery } from './plugins'

export interface Attachment {
  id: string
  name: string
  type: string
  size: number
  localPath?: string
  previewUrl?: string
  status?: 'queued' | 'uploaded' | 'failed'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  attachments?: Attachment[]
  thinking?: string
}

export type TurnStatus = 'working' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface TurnActivity {
  status: 'idle' | 'working' | 'done' | 'failed' | 'cancelled' | 'interrupted'
  startedAt: string | null
  finishedAt: string | null
  events: AgentEvent[]
  /** 思考全文，供对话模式的思考区展开查看；旧回合没有这个字段 */
  thinking?: string
  /**
   * 按思考轮次切分的正文：一轮里模型会思考多次，全文只有一份的话执行轨迹上
   * 第 2 个及以后的 Thinked 组展开就是空的。第 N 段对应第 N 个 thinking_started。
   * 旧回合没有这个字段，回退到 thinking 全文。
   */
  thinkingSegments?: string[]
  /** 本轮完整生成轨迹，包含工具间说明文本；旧回合回退到 assistantMessage。 */
  transcript?: string
  /** Runtime 维护的执行快照；旧回合没有这个字段。 */
  execution?: ExecutionSnapshot
}

export interface TurnRuntimeConfig {
  modelId: number | null
  thinkingLevel: ThinkingLevel
  mode: ConversationMode
  permission: PermissionPreset | null
  project: string | null
}

export interface Citation {
  id?: string
  title?: string
  url?: string
  quote?: string
  [key: string]: unknown
}

export interface ArtifactReference {
  id?: string
  kind?: string
  name?: string
  path?: string
  url?: string
  [key: string]: unknown
}

export interface ConversationTurn {
  id: string
  conversationId: string
  userMessage: {
    text: string
    createdAt: string
  }
  attachments: Attachment[]
  activity: TurnActivity | null
  assistantMessage: {
    text: string
    createdAt: string
  } | null
  citations: Citation[]
  artifacts: ArtifactReference[]
  runtimeConfig: TurnRuntimeConfig
  status: TurnStatus
  createdAt: string
  updatedAt: string
}

export interface ConversationTurnPatch {
  userMessage?: ConversationTurn['userMessage']
  attachments?: Attachment[]
  activity?: TurnActivity | null
  assistantMessage?: ConversationTurn['assistantMessage']
  citations?: Citation[]
  artifacts?: ArtifactReference[]
  runtimeConfig?: Partial<TurnRuntimeConfig>
  status?: TurnStatus
}

export interface ConversationRecord {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  archived: boolean
  projectId: string | null
  /** 会话绑定的模型；null 表示还没发过消息，打开时用账户默认模型。 */
  modelId: number | null
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  text: string
  createdAt: string
}

export interface ConversationDetailed extends ConversationRecord {
  runtime: {
    mode: ConversationMode | null
    modelId: number | null
    provider: string | null
    thinkingLevel: ThinkingLevel | null
    permission: PermissionPreset | null
    status: TurnStatus | null
    sessionId: string | null
  }
  context: ContextState | null
  summary: ContextSummary | null
  compactionHistory: CompactionHistory[]
  contextPolicy: ContextPolicy | null
}

export type ConversationInspector = ConversationDetailed

/**
 * 会话列表的筛选条件。模式与状态取自会话最后一轮，
 * 必须在库里筛完再分页，否则「共 N 条」和筛选后的列表对不上。
 */
export interface ConversationPageQuery extends PageQuery {
  /** 'all' 不按项目筛；'unassigned' 只要快速对话；其余值当作项目 id */
  projectScope?: string
  mode?: ConversationMode
  /** 'idle' 表示还没有任何一轮 */
  status?: TurnStatus | 'idle'
}

/** 会话页顶部的统计卡片，全库口径，不受分页影响。 */
export interface ConversationStats {
  total: number
  active: number
  agent: number
  failed: number
}
