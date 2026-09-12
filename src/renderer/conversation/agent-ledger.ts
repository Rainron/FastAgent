import type { AgentRunRecord, AgentRunStatus, AgentTaskRecord, AgentTaskStatus } from '../../shared/types'

const RUN_STATUS_LABEL: Record<AgentRunStatus, string> = {
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断'
}

const TASK_STATUS_LABEL: Record<AgentTaskStatus, string> = {
  queued: '排队中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  timeout: '超时'
}

export function agentRunStatusLabel(status: AgentRunStatus): string {
  return RUN_STATUS_LABEL[status]
}

export function agentTaskStatusLabel(status: AgentTaskStatus): string {
  return TASK_STATUS_LABEL[status]
}

/** 台账里的耗时以落库的 duration 为准；执行中的行没有 duration，用当前时间现算。 */
export function taskDurationMs(task: Pick<AgentTaskRecord, 'durationMs' | 'startedAt' | 'finishedAt'>, now: number): number {
  if (typeof task.durationMs === 'number') return Math.max(0, task.durationMs)
  return Math.max(0, (task.finishedAt ?? now) - task.startedAt)
}

export function runDurationMs(run: Pick<AgentRunRecord, 'startedAt' | 'finishedAt'>, now: number): number {
  return Math.max(0, (run.finishedAt ?? now) - run.startedAt)
}

export interface TaskTally {
  total: number
  completed: number
  failed: number
  running: number
}

/** 失败口径包含 timeout：用户关心的是「这次委派没拿到结果」，不是它怎么没拿到。 */
export function tallyTasks(tasks: readonly AgentTaskRecord[]): TaskTally {
  let completed = 0
  let failed = 0
  let running = 0
  for (const task of tasks) {
    if (task.status === 'completed') completed += 1
    else if (task.status === 'failed' || task.status === 'timeout' || task.status === 'cancelled') failed += 1
    else running += 1
  }
  return { total: tasks.length, completed, failed, running }
}

export function describeTally(tally: TaskTally): string {
  if (!tally.total) return '无委派任务'
  const parts = [`${tally.total} 个任务`]
  if (tally.completed) parts.push(`${tally.completed} 完成`)
  if (tally.failed) parts.push(`${tally.failed} 未完成`)
  if (tally.running) parts.push(`${tally.running} 执行中`)
  return parts.join(' · ')
}
