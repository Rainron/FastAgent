import type { ContextStrategy } from './common'

export type CacheUsageAvailability = 'reported' | 'unknown'

export interface ModelUsageRecord {
  requestId: string
  conversationId: string
  turnId: string
  runId: string
  modelId: number
  provider: string
  modelName: string
  createdAt: string
  /** Pi 已将缓存读写从 input 中扣除，三个输入分类互斥。 */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  readAvailability: CacheUsageAvailability
  writeAvailability: CacheUsageAvailability
  status: 'completed' | 'failed' | 'cancelled'
}

export interface ModelUsageAggregate {
  requestCount: number
  reportedReadRequests: number
  reportedWriteRequests: number
  /** 包含缓存读写；用作总输入展示，未知缓存报告的请求也计入。 */
  inputTokens: number
  outputTokens: number
  /** 命中率只统计已报告缓存读取的请求，避免把未知请求算成未命中。 */
  readInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface ModelUsageSummary {
  latest: ModelUsageRecord | null
  turn: ModelUsageAggregate
  session: ModelUsageAggregate
}

export interface ContextPolicy {
  conversationId: string
  strategy: ContextStrategy
  autoSummary: boolean
  triggerRatio: number | null
  keepRecentTurns: number | null
  inheritGlobal: boolean
}

export interface ContextState {
  conversationId: string
  contextWindow: number
  estimatedTokens: number
  messageTokens: number
  toolTokens: number
  systemTokens: number
  /** 摘要与附件属于请求上下文，但旧数据库没有对应列，因此允许缺省。 */
  summaryTokens?: number
  attachmentTokens?: number
  modelId?: number | null
  provider?: string | null
  countingMethod?: 'provider-usage' | 'fallback-estimate'
  compactionCount: number
  latestSummaryId: string | null
  updatedAt: string
}

export interface ContextSummary {
  id: string
  conversationId: string
  version: number
  summaryText: string
  coveredTurnStart: string | null
  coveredTurnEnd: string | null
  inputTokens: number
  outputTokens: number
  createdAt: string
}

export interface CompactionHistory {
  id: string
  conversationId: string
  strategy: ContextStrategy
  triggerReason: string
  beforeTokens: number
  afterTokens: number
  coveredTurnStart: string | null
  coveredTurnEnd: string | null
  summaryId: string | null
  durationMs: number
  createdAt: string
}

export type CompactionRecord = CompactionHistory
