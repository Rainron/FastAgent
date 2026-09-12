/** 跨会话长期记忆。会话内历史仍由 conversation_turns 与摘要压缩负责，这里只存值得跨会话复用的信息。 */
export type MemoryScope = 'global' | 'workspace' | 'agent'

export type MemoryType = 'preference' | 'fact' | 'decision' | 'experience'

/** superseded 表示被新记忆替代，deleted 是用户软删；召回只看 active。 */
export type MemoryStatus = 'active' | 'superseded' | 'deleted'

export interface MemoryRecord {
  id: string
  scope: MemoryScope
  /** workspace 存 projectId，agent 存 Sub-agent id，global 为 null。 */
  scopeId: string | null
  type: MemoryType
  content: string
  /** 1~5，越大越优先注入。 */
  importance: number
  /** 0~1，抽取置信度。 */
  confidence: number
  sourceConversationId: string | null
  sourceTurnId: string | null
  sourceRunId: string | null
  status: MemoryStatus
  supersededBy: string | null
  createdAt: number
  updatedAt: number
  lastAccessedAt: number | null
  expiresAt: number | null
}

/** 管理界面的列表查询；scopeId 为 undefined 表示不限定，为 null 表示只要 global。 */
export interface MemoryListQuery {
  scope?: MemoryScope
  scopeId?: string | null
  type?: MemoryType
  status?: MemoryStatus
  keyword?: string
  page?: number
  pageSize?: number
}

export interface MemoryUpdateInput {
  content?: string
  type?: MemoryType
  importance?: number
  status?: MemoryStatus
}

/** 一次召回的作用域组合：当前项目 + 全局 +（可选）指定 Sub-agent。 */
export interface MemoryRecallScopes {
  workspaceId: string | null
  agentId?: string | null
}

export interface MemoryRecallHit {
  memory: MemoryRecord
  /** 排序得分，越大越靠前；仅用于调试与测试断言。 */
  score: number
}

export interface MemorySettings {
  enabled: boolean
  /** 关闭后仍会召回已有记忆，只是不再自动新增。 */
  autoExtract: boolean
  /** 单轮注入条数上限，3~8。 */
  maxRecall: number
  /** 自动提取使用的模型 id；null 表示跟随会话当前模型。 */
  extractModelId: number | null
}
