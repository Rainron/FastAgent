import type { ConversationTurn } from '../../shared/types'

/**
 * 时间线上的模型切换点：数据取自每个回合已落库的 runtimeConfig.modelId，
 * 不额外读 session 的 model_change entry，避免为一行提示多开一条 IPC。
 * 返回「应在该回合之前插入切换标记」的回合 id 集合。
 */
export function modelChangeTurnIds(turns: Array<Pick<ConversationTurn, 'id' | 'runtimeConfig'>>): Set<string> {
  const marked = new Set<string>()
  // 没记录模型的旧回合不参与比较，否则历史数据会凭空多出一次切换。
  let lastKnown: number | null = null
  for (const turn of turns) {
    const current = turn.runtimeConfig.modelId ?? null
    if (current === null) continue
    if (lastKnown !== null && current !== lastKnown) marked.add(turn.id)
    lastKnown = current
  }
  return marked
}
