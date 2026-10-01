import type { ConversationRunState, RunStatus } from '../shared/types'
export type { ConversationRunState } from '../shared/types'

export type RunStatusTone = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'

export function runStatusPresentation(state: ConversationRunState | undefined) {
  if (!state || state.status === 'idle' || ((state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') && !state.hasUnreadResult)) return null
  const presentation: Record<RunStatus, { tone: RunStatusTone; label: string }> = {
    idle: { tone: 'cancelled', label: '' }, running: { tone: 'running', label: '正在执行' }, waiting_user: { tone: 'waiting', label: '等待你的操作' }, paused: { tone: 'waiting', label: '已暂停' }, completed: { tone: 'completed', label: '已完成，有未查看的结果' }, failed: { tone: 'failed', label: '执行失败，尚未查看' }, cancelled: { tone: 'cancelled', label: '运行被中断，尚未查看' }
  }
  return presentation[state.status]
}

const priority: RunStatus[] = ['waiting_user', 'paused', 'failed', 'running', 'completed', 'cancelled', 'idle']

export function projectRunStatus(states: ConversationRunState[], projectId: string) {
  const candidates = states.filter((state) => state.projectId === projectId && runStatusPresentation(state))
  return candidates.sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0]
}

/**
 * 终态事件是否留下未读结果。用户自己点停止的 cancelled 不算：没有需要回头看的新内容；
 * 被动的 interrupted（重启、崩溃、上限截断）才需要提醒。与主进程 run-state 的投影同一口径。
 */
export function hasUnreadResultFor(eventType: string): boolean {
  return eventType === 'completed' || eventType === 'failed' || eventType === 'interrupted'
}
