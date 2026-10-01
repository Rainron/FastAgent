import type { AppSettings, ContextPolicy, ContextState, ContextStrategy, ConversationTurn } from '../shared/types'

/** 保底保留的最近回合数，避免压缩把当前任务上下文清空。 */
const MIN_KEEP_RECENT_TURNS = 2
const DEFAULT_KEEP_RECENT_TURNS = 8

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4))
}

/** 压缩后期望达到的上下文占比，对应文档四档策略的「压缩后目标」。 */
export function contextTargetRatio(strategy: ContextStrategy) {
  if (strategy === 'aggressive') return 0.45
  if (strategy === 'conservative') return 0.68
  if (strategy === 'disabled') return 1
  return 0.55
}

/** 压缩后目标占比，会话级 targetRatio 优先于策略默认值。与 triggerRatioFor 同形。 */
export function targetRatioFor(policy: ContextPolicy) {
  if (typeof policy.targetRatio === 'number') return policy.targetRatio
  return contextTargetRatio(policy.strategy)
}

/** 自动压缩的触发占比，会话级 triggerRatio 优先于策略默认值。 */
export function triggerRatioFor(policy: ContextPolicy) {
  if (typeof policy.triggerRatio === 'number') return policy.triggerRatio
  if (policy.strategy === 'aggressive') return 0.68
  if (policy.strategy === 'conservative') return 0.85
  return 0.78
}

/**
 * 会话没有独立策略时回退到全局设置。
 * AppSettings 用 contextStrategy 命名，ContextPolicy 用 strategy，必须显式映射，
 * 直接展开 AppSettings 会让 strategy 变成 undefined 并使「关闭」失效。
 */
export function resolvePolicy(settings: AppSettings, stored: ContextPolicy | null, conversationId: string): ContextPolicy {
  if (stored) return stored
  return {
    conversationId,
    strategy: settings.contextStrategy,
    autoSummary: settings.autoSummary,
    triggerRatio: settings.triggerRatio,
    targetRatio: settings.targetRatio,
    keepRecentTurns: settings.keepRecentTurns,
    inheritGlobal: true
  }
}

/** Pi 自带的压缩参数默认值，窗口未知时原样沿用，不做猜测。 */
const PI_DEFAULT_RESERVE_TOKENS = 16_384
const PI_DEFAULT_KEEP_RECENT_TOKENS = 20_000
/** 触发点与保留区的下限：再小就会压完立刻又触发。窗口很小时按占比退让，避免两者之和顶穿窗口。 */
const MIN_RESERVE_TOKENS = 8_192
const MIN_KEEP_RECENT_TOKENS = 4_096

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * 把桌面侧的策略/阈值翻译成 Pi 的会话内压缩参数。
 * Pi 的判定是 `tokens > contextWindow - reserveTokens`，只认绝对量；
 * 不做这层换算的话，设置里的触发占比对单个长回合完全不起作用。
 */
export function piCompactionSettings(policy: ContextPolicy, contextWindow: number) {
  const enabled = policy.autoSummary && policy.strategy !== 'disabled'
  if (!(contextWindow > 0)) {
    return { enabled, reserveTokens: PI_DEFAULT_RESERVE_TOKENS, keepRecentTokens: PI_DEFAULT_KEEP_RECENT_TOKENS }
  }
  const reserveTokens = clamp(
    Math.round(contextWindow * (1 - triggerRatioFor(policy))),
    Math.min(MIN_RESERVE_TOKENS, Math.round(contextWindow * 0.1)),
    Math.round(contextWindow * 0.5)
  )
  const keepRecentTokens = clamp(
    Math.round(contextWindow * targetRatioFor(policy)) - reserveTokens,
    Math.min(MIN_KEEP_RECENT_TOKENS, Math.round(contextWindow * 0.05)),
    contextWindow - reserveTokens - Math.round(contextWindow * 0.05)
  )
  return { enabled, reserveTokens, keepRecentTokens }
}

/** 按保留回合数把历史切成可压缩区与必须保留区。 */
export function splitTurns(turns: ConversationTurn[], keepRecentTurns: number | null) {
  const keep = Math.max(MIN_KEEP_RECENT_TURNS, keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS)
  const cut = Math.max(0, turns.length - keep)
  return { compressible: turns.slice(0, cut), kept: turns.slice(cut) }
}

/** 已被摘要覆盖的回合不参与上下文计算：避免压缩后 token 用量虚高，反复触发下一轮压缩。 */
export function turnsAfterCoveredTurn(turns: ConversationTurn[], coveredTurnEnd: string | null) {
  if (!coveredTurnEnd) return turns
  const index = turns.findIndex((turn) => turn.id === coveredTurnEnd)
  if (index < 0) return turns
  return turns.slice(index + 1)
}

function truncate(text: string, limit: number) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
}

function listOrDash(items: string[]) {
  const unique = [...new Set(items.filter(Boolean))]
  return unique.length ? unique.map((item) => `- ${item}`).join('\n') : '- —'
}

/** 摘要格式的七个部分。模型摘要不可用时的本地回退实现。 */
export function heuristicSummary(turns: ConversationTurn[], previousSummary?: string | null): string {
  const latest = turns.at(-1)
  const failed = turns.filter((turn) => turn.status === 'failed')
  const completed = turns.filter((turn) => turn.status === 'completed')
  const references = turns.flatMap((turn) => turn.attachments.map((item) => item.name))
  const fileEvents = turns.flatMap((turn) => (turn.activity?.events || []).filter((event) => event.type === 'file_changed').map((event) => event.path || event.detail || ''))
  const toolEvents = turns.flatMap((turn) => (turn.activity?.events || []).filter((event) => event.type === 'tool_started' || event.type === 'tool_result').map((event) => event.tool || ''))
  const latestStep = latest?.activity?.events.at(-1)
  return [
    'Current goal',
    listOrDash([truncate(latest?.userMessage.text || '', 180)]),
    '',
    'User constraints',
    listOrDash(turns.slice(0, 3).map((turn) => truncate(turn.userMessage.text, 120))),
    '',
    'Decisions',
    listOrDash(previousSummary ? [truncate(previousSummary, 240)] : []),
    '',
    'Completed',
    listOrDash([`已完成 ${completed.length} 个回合`, ...fileEvents.slice(-5).map((item) => truncate(item, 120))]),
    '',
    'Open issues',
    listOrDash(failed.map((turn) => truncate(turn.userMessage.text, 120))),
    '',
    'Important references',
    listOrDash(references.slice(-10)),
    '',
    'Agent state',
    listOrDash([
      latestStep ? `最近事件：${latestStep.type}${latestStep.tool ? ` · ${latestStep.tool}` : ''}` : '',
      toolEvents.length ? `工具调用 ${toolEvents.length} 次` : ''
    ])
  ].join('\n')
}

/** 送给模型生成结构化摘要的输入，控制在预算内避免二次溢出。 */
export function buildSummarySourceText(turns: ConversationTurn[], previousSummary?: string | null, charBudget = 24_000): string {
  const blocks = turns.map((turn) => {
    const user = truncate(turn.userMessage.text, 1200)
    const assistant = truncate(turn.assistantMessage?.text || '', 1200)
    const tools = (turn.activity?.events || [])
      .filter((event) => event.type === 'tool_started' || event.type === 'tool_result' || event.type === 'file_changed')
      .map((event) => `${event.tool || event.type}${event.path ? ` ${event.path}` : ''}`)
    return [
      `## 回合 ${turn.id} · ${turn.status}`,
      `User: ${user}`,
      assistant ? `Assistant: ${assistant}` : '',
      tools.length ? `Tools: ${[...new Set(tools)].slice(0, 12).join(', ')}` : ''
    ].filter(Boolean).join('\n')
  })
  const body = blocks.join('\n\n')
  const trimmed = body.length > charBudget ? body.slice(body.length - charBudget) : body
  return previousSummary ? `# 已有摘要\n${previousSummary}\n\n# 待压缩回合\n${trimmed}` : `# 待压缩回合\n${trimmed}`
}

/** 压缩后写回的上下文估算：摘要本身的开销与策略目标取较大值。 */
export function projectCompactedState(before: ContextState, strategy: ContextStrategy, summaryText: string): ContextState {
  const summaryTokens = estimateTokens(summaryText)
  const target = Math.round(before.contextWindow * contextTargetRatio(strategy))
  return {
    ...before,
    estimatedTokens: Math.max(summaryTokens, Math.min(before.estimatedTokens, target)),
    messageTokens: Math.max(summaryTokens, Math.round(before.messageTokens * contextTargetRatio(strategy))),
    toolTokens: Math.round(before.toolTokens * 0.2),
    // 摘要后的数字是策略投影，不再是压缩前那次 provider usage 的真实值。
    countingMethod: 'fallback-estimate'
  }
}
