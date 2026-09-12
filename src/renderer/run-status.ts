import type { ConversationRunState, RunStatus } from '../shared/types'
export type { ConversationRunState } from '../shared/types'

export type RunStatusTone = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'

export function runStatusPresentation(state: ConversationRunState | undefined) {
  if (!state || state.status === 'idle' || ((state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') && !state.hasUnreadResult)) return null
  const presentation: Record<RunStatus, { tone: RunStatusTone; label: string }> = {
    idle: { tone: 'cancelled', label: '' }, running: { tone: 'running', label: '正在执行' }, waiting_user: { tone: 'waiting', label: '等待你的操作' }, completed: { tone: 'completed', label: '任务已完成' }, failed: { tone: 'failed', label: '执行失败' }, cancelled: { tone: 'cancelled', label: '已取消' }
  }
  return presentation[state.status]
}

const priority: RunStatus[] = ['waiting_user', 'failed', 'running', 'completed', 'cancelled', 'idle']

export function projectRunStatus(states: ConversationRunState[], projectId: string) {
  const candidates = states.filter((state) => state.projectId === projectId && runStatusPresentation(state))
  return candidates.sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0]
}
