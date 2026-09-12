import { randomUUID } from 'node:crypto'
import type { ModelUsageRecord } from '../shared/types'

interface UsageContext {
  conversationId: string
  turnId: string
  runId: string
  modelId: number
  provider: string
  modelName: string
  baseUrl?: string | null
  subAgent?: boolean
}

const OFFICIAL_READ_ENDPOINTS = new Set([
  'https://api.openai.com/v1',
  'https://api.anthropic.com', 'https://api.anthropic.com/v1',
  'https://api.deepseek.com', 'https://api.deepseek.com/v1',
  'https://api.moonshot.cn/v1', 'https://api.moonshot.ai/v1',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
])

function endpoint(value: string | null | undefined): string {
  try {
    const url = new URL(value || '')
    if (url.username || url.password || url.search || url.hash) return ''
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch { return '' }
}

function tokens(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

export function normalizeModelUsage(raw: unknown, context: UsageContext, requestId: string): ModelUsageRecord | null {
  if (!raw || typeof raw !== 'object' || context.subAgent) return null
  const message = raw as { role?: string; timestamp?: number; stopReason?: string; usage?: Record<string, unknown> }
  if (message.role !== 'assistant' || !message.usage || typeof message.usage !== 'object') return null
  const inputTokens = tokens(message.usage.input)
  const outputTokens = tokens(message.usage.output)
  const cacheReadTokens = tokens(message.usage.cacheRead)
  const cacheWriteTokens = tokens(message.usage.cacheWrite)
  const hasUsage = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens > 0
  const target = endpoint(context.baseUrl)
  // Pi 缺省缓存字段也会归零；仅已知官方接口且收到有效 usage 才把零视为真实报告。
  const readReported = cacheReadTokens > 0 || (hasUsage && OFFICIAL_READ_ENDPOINTS.has(target))
  const writeReported = cacheWriteTokens > 0 || (hasUsage && (target === 'https://api.anthropic.com' || target === 'https://api.anthropic.com/v1'))
  return {
    requestId, conversationId: context.conversationId, turnId: context.turnId, runId: context.runId,
    modelId: context.modelId, provider: context.provider, modelName: context.modelName,
    createdAt: new Date(typeof message.timestamp === 'number' && Number.isFinite(message.timestamp) ? message.timestamp : Date.now()).toISOString(),
    inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
    readAvailability: readReported ? 'reported' : 'unknown', writeAvailability: writeReported ? 'reported' : 'unknown',
    status: message.stopReason === 'aborted' ? 'cancelled' : message.stopReason === 'error' ? 'failed' : 'completed'
  }
}

export function createModelUsageCollector(context: UsageContext, onRecord: (record: ModelUsageRecord) => void) {
  const objects = new WeakSet<object>()
  const requests = new Set<string>()
  return (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || objects.has(raw) || context.subAgent) return
    const message = raw as { responseId?: string }
    const requestId = `${context.runId}:${message.responseId || randomUUID()}`
    if (requests.has(requestId)) return
    const record = normalizeModelUsage(raw, context, requestId)
    if (!record) return
    onRecord(record)
    objects.add(raw)
    requests.add(requestId)
  }
}
