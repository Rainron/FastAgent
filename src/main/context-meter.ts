export type ContextCountingMethod = 'provider-usage' | 'fallback-estimate'

export interface ContextToolInput {
  name: string
  input?: string
  result?: string
}

export interface ContextTurnInput {
  user: string
  assistant?: string
  tools?: ContextToolInput[]
}

export interface ContextUsageInput {
  inputTokens: number
  outputTokens?: number
}

export interface ContextMeterInput {
  modelId: number
  provider: string
  contextWindow: number
  systemPrompt?: string
  summary?: string | null
  turns: ContextTurnInput[]
  attachments?: string[]
  usage?: ContextUsageInput
}

export interface ContextMeasurement {
  modelId: number
  provider: string
  contextWindow: number
  estimatedTokens: number
  systemTokens: number
  messageTokens: number
  toolTokens: number
  attachmentTokens: number
  summaryTokens: number
  countingMethod: ContextCountingMethod
}

// CJK 每字约 1~2 token，按字符数/4 估算会低估近 4 倍，中文会话因此长期显示偏低；
// 中文按每字 1 token 计，其余字符维持字符/4 的近似。
function estimate(text: string | null | undefined) {
  if (!text) return 0
  let cjk = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x4e00 && code <= 0x9fff) cjk += 1
  }
  return Math.max(1, Math.ceil(cjk + (text.length - cjk) / 4))
}

function reconcileBreakdown(values: number[], total: number): number[] {
  const safeTotal = Math.max(0, Math.round(total))
  const estimatedTotal = values.reduce((sum, value) => sum + value, 0)
  if (safeTotal === 0) return values.map(() => 0)
  if (estimatedTotal === 0) return values.map((_, index) => index === 0 ? safeTotal : 0)
  const scaled = values.map((value, index) => {
    const exact = value / estimatedTotal * safeTotal
    return { index, value: Math.floor(exact), fraction: exact - Math.floor(exact) }
  })
  let remainder = safeTotal - scaled.reduce((sum, item) => sum + item.value, 0)
  for (const item of [...scaled].sort((left, right) => right.fraction - left.fraction || left.index - right.index)) {
    if (remainder <= 0) break
    item.value += 1
    remainder -= 1
  }
  return scaled.sort((left, right) => left.index - right.index).map((item) => item.value)
}

export class ContextMeter {
  measure(input: ContextMeterInput): ContextMeasurement {
    const estimatedSystem = estimate(input.systemPrompt)
    const estimatedSummary = estimate(input.summary)
    const estimatedMessages = input.turns.reduce((total, turn) => total + estimate(turn.user) + estimate(turn.assistant), 0)
    const estimatedTools = input.turns.reduce((total, turn) => total + (turn.tools ?? []).reduce((inner, tool) => inner + estimate(tool.name) + estimate(tool.input) + estimate(tool.result), 0), 0)
    const estimatedAttachments = (input.attachments ?? []).reduce((total, attachment) => total + estimate(attachment), 0)
    const providerTotal = input.usage ? Math.max(0, input.usage.inputTokens) : null
    const [messageTokens, toolTokens, systemTokens, summaryTokens, attachmentTokens] = providerTotal === null
      ? [estimatedMessages, estimatedTools, estimatedSystem, estimatedSummary, estimatedAttachments]
      : reconcileBreakdown([estimatedMessages, estimatedTools, estimatedSystem, estimatedSummary, estimatedAttachments], providerTotal)
    const estimatedTokens = providerTotal ?? messageTokens + toolTokens + systemTokens + summaryTokens + attachmentTokens

    return {
      modelId: input.modelId,
      provider: input.provider,
      contextWindow: input.contextWindow,
      estimatedTokens,
      systemTokens,
      messageTokens,
      toolTokens,
      attachmentTokens,
      summaryTokens,
      countingMethod: input.usage ? 'provider-usage' : 'fallback-estimate'
    }
  }
}
