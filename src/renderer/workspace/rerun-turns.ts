import type { ConversationTurn } from '../../shared/types'

/**
 * 重跑 / 编辑重发第 N 轮后的回合列表：第 N 轮换成重置后的那份，之后的回合全部去掉。
 * 与主进程 chat:send 的截断口径一致（按列表顺序，第 N 轮之后的都算）。
 * 找不到第 N 轮时原样返回，不能凭空把列表截短。
 */
export function truncateTurnsForRerun(turns: ConversationTurn[], reset: ConversationTurn): ConversationTurn[] {
  const index = turns.findIndex((turn) => turn.id === reset.id)
  if (index < 0) return turns
  return [...turns.slice(0, index), reset]
}
