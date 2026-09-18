import type { ConversationRunState } from '../shared/types'

/**
 * 挑出「落库还是 running、但主进程里已经没有对应 run」的运行状态。
 *
 * 界面重载不会重启主进程：渲染层重新 boot 时活着的 run 仍在 activeRuns 里，
 * 把它们一起标成失败会让还在跑的任务当场显示失败（并让渲染层放行第二个 run）。
 */
export function staleRunStates(states: ConversationRunState[], liveConversationIds: Set<string>): ConversationRunState[] {
  return states.filter((state) => state.status === 'running' && !liveConversationIds.has(state.conversationId))
}
