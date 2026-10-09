import type { ConversationTurn } from '../../shared/types'

/**
 * 删除本轮问答、重跑截断后续回合时的退场：被删的回合先在原位折叠淡出，再真正从列表里拿掉。
 * 这里只放纯逻辑：找出被删的回合、把它们插回原来的位置。
 */

/**
 * 相对上一版列表被删掉的回合。只认同一个会话里的删除：切会话时整份列表都换了，
 * 那不是删除，不能让上一个会话的回合在新会话里播退场。当前列表为空（删光了、切到空会话）同样不播。
 */
export function detectRemovedTurns(previous: ConversationTurn[], current: ConversationTurn[]): ConversationTurn[] {
  if (previous === current || current.length === 0 || previous.length === 0) return []
  const conversationId = current[0].conversationId
  const present = new Set(current.map((turn) => turn.id))
  return previous.filter((turn) => turn.conversationId === conversationId && !present.has(turn.id))
}

export interface RenderedTurn {
  turn: ConversationTurn
  exiting: boolean
}

/**
 * 当前回合 + 退场中的回合，按删除前的顺序排：退场的回合留在原位，后面的回合不会先跳上来。
 * 删除前列表里没有的（刚新增的）排在最后，与它们本来的位置一致。
 */
export function mergeExitingTurns(current: ConversationTurn[], exiting: ConversationTurn[], previousOrder: string[]): RenderedTurn[] {
  if (exiting.length === 0) return current.map((turn) => ({ turn, exiting: false }))
  const currentById = new Map(current.map((turn) => [turn.id, turn]))
  const exitingById = new Map(exiting.map((turn) => [turn.id, turn]))
  const placed = new Set<string>()
  const result: RenderedTurn[] = []
  for (const id of previousOrder) {
    const live = currentById.get(id)
    if (live) { result.push({ turn: live, exiting: false }); placed.add(id); continue }
    const leaving = exitingById.get(id)
    if (leaving) { result.push({ turn: leaving, exiting: true }); placed.add(id) }
  }
  for (const turn of current) if (!placed.has(turn.id)) result.push({ turn, exiting: false })
  return result
}
