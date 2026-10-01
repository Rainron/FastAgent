import type { ConversationTurn, TurnSessionAnchor } from '../shared/types'

/**
 * 重跑第 N 轮时怎么把模型上下文退回到第 N 轮之前。
 *
 * - `branch`：锚点有效，从锚点节点切出一份只含根→锚点路径的新 session，后面的历史整段不带；
 * - `reset`：第 N 轮是这个 session 的第一轮，直接重开 session，沿用开 session 时的那份摘要种子；
 * - `reseed`：拿不到可用锚点（旧回合、session 后来被换过），重开 session 并用第 N 轮之前的回合原文重做种子；
 * - `none`：没有 session、摘要也不涉及第 N 轮及以后，上下文里本来就没有要撤掉的东西。
 */
export type SessionRewindPlan =
  | { kind: 'branch'; sessionFile: string; leafId: string }
  | { kind: 'reset' }
  | { kind: 'reseed' }
  | { kind: 'none' }

export function planSessionRewind(input: {
  anchor: TurnSessionAnchor | null
  currentSessionFile: string | null
  /** 锚点所在 session 文件还在磁盘上。 */
  anchorFileExists: boolean
  /** 最近一份回合摘要覆盖到了第 N 轮或更后面的回合。 */
  summaryCoversTarget: boolean
}): SessionRewindPlan {
  const { anchor, currentSessionFile } = input
  // 锚点只在「它记下的 session 仍是当前 session」时可信：换过 session（按回合摘要重开、跨协议换模型）
  // 之后，旧文件里的节点 id 与现在送进模型的上下文已经没有关系。
  if (anchor && currentSessionFile && anchor.sessionFile === currentSessionFile && input.anchorFileExists) {
    return anchor.leafId ? { kind: 'branch', sessionFile: anchor.sessionFile, leafId: anchor.leafId } : { kind: 'reset' }
  }
  if (currentSessionFile || input.summaryCoversTarget) return { kind: 'reseed' }
  return { kind: 'none' }
}

/** 摘要的覆盖终点是否落在第 targetIndex 轮或之后；找不到终点回合（已被删）时按覆盖处理，宁可重做种子。 */
export function summaryCoversTurn(coveredTurnEnd: string | null, turns: Pick<ConversationTurn, 'id'>[], targetIndex: number): boolean {
  if (!coveredTurnEnd) return false
  const end = turns.findIndex((turn) => turn.id === coveredTurnEnd)
  return end < 0 || end >= targetIndex
}

const SEED_TURN_CHARS = 1_200
const SEED_CHAR_BUDGET = 24_000

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/**
 * 没有可用锚点时的上下文种子：第 N 轮之前的问答原文（各截一段），超预算时保留最近的部分。
 * 不调模型做摘要——重跑要立刻开始，而且原文比二次转述更不容易丢约束。
 * 返回空串表示之前没有任何可带的内容。
 */
export function buildRewindSeed(turns: ConversationTurn[], previousSummary: string | null): string {
  const blocks = turns
    .map((turn) => {
      const user = clip(turn.userMessage.text, SEED_TURN_CHARS)
      const assistant = clip(turn.assistantMessage?.text ?? '', SEED_TURN_CHARS)
      if (!user && !assistant) return ''
      return [`User: ${user}`, assistant ? `Assistant: ${assistant}` : ''].filter(Boolean).join('\n')
    })
    .filter(Boolean)
  let body = blocks.join('\n\n')
  if (body.length > SEED_CHAR_BUDGET) body = `…\n${body.slice(body.length - SEED_CHAR_BUDGET)}`
  const parts: string[] = []
  if (previousSummary?.trim()) parts.push(`# 更早的会话摘要\n${previousSummary.trim()}`)
  if (body) parts.push(`# 此前回合原文（工具调用细节已省略）\n${body}`)
  return parts.join('\n\n')
}
