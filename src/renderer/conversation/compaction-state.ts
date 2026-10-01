export type CompactionStatus = 'running' | 'success' | 'failed' | 'timed_out' | 'cancelled'

export interface CompactionState {
  status: CompactionStatus
  taskId: string
  modelId: number | null
  progress: number
  phase: string
  startedAt: number
  error?: string
  /**
   * 由主进程自动触发（阈值兜底、换模型前压缩），不是用户点的「立即压缩」。
   * 自动压缩失败时不弹换模型重试弹层——用户没主动发起它，弹层只会打断当前工作。
   */
  auto?: boolean
}

export type CompactionStates = Record<string, CompactionState>

export function initialCompactionStates(): CompactionStates {
  return {}
}

export function beginCompaction(states: CompactionStates, conversationId: string, modelId: number | null, now = Date.now(), auto = false): CompactionStates {
  const current = states[conversationId]
  if (current?.status === 'running') return states
  return {
    ...states,
    [conversationId]: {
      status: 'running',
      taskId: `compaction-${conversationId}-${now}`,
      modelId,
      progress: 0,
      phase: auto ? '正在自动压缩' : '准备压缩',
      startedAt: now,
      auto
    }
  }
}

/**
 * 自动压缩的收尾：成功由 completeCompaction 接管，失败与「运行已结束但压缩状态还挂着」都走这里。
 * 不留在 failed 态是刻意的——那会弹出换模型重试弹层，而用户根本没发起过这次压缩。
 */
export function clearAutoCompaction(states: CompactionStates, conversationId: string): CompactionStates {
  const current = states[conversationId]
  if (!current?.auto || current.status !== 'running') return states
  return clearCompaction(states, conversationId)
}

export function updateCompactionProgress(states: CompactionStates, conversationId: string, patch: Pick<CompactionState, 'progress' | 'phase'>): CompactionStates {
  const current = states[conversationId]
  if (!current || current.status !== 'running') return states
  return { ...states, [conversationId]: { ...current, ...patch } }
}

export function completeCompaction(states: CompactionStates, conversationId: string): CompactionStates {
  const current = states[conversationId]
  if (!current) return states
  return { ...states, [conversationId]: { ...current, status: 'success', progress: 100, phase: '压缩完成', error: undefined } }
}

export function failCompaction(states: CompactionStates, conversationId: string, error: string): CompactionStates {
  const current = states[conversationId]
  if (!current) return states
  const timedOut = /超时|timeout/i.test(error)
  const cancelled = /取消|cancel/i.test(error)
  return { ...states, [conversationId]: { ...current, status: cancelled ? 'cancelled' : timedOut ? 'timed_out' : 'failed', phase: cancelled ? '已取消' : timedOut ? '压缩超时' : '压缩失败', error } }
}

export function cancelCompaction(states: CompactionStates, conversationId: string): CompactionStates {
  const current = states[conversationId]
  if (!current) return states
  return { ...states, [conversationId]: { ...current, status: 'cancelled', phase: '已取消', error: undefined } }
}

export function clearCompaction(states: CompactionStates, conversationId: string): CompactionStates {
  if (!(conversationId in states)) return states
  const next = { ...states }
  delete next[conversationId]
  return next
}
