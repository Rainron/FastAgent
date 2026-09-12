import type { SubAgentResult, SubAgentStatus } from './subagent-types'
import { SUBAGENT_LIMITS } from './subagent-types'
import { truncateSubAgentOutput } from './subagent-handoff'

export interface ScheduledSubAgentTask {
  taskId: string
  agentId: string
  task: string
}

export interface SubAgentSchedulerOptions {
  concurrency?: number
  signal: AbortSignal
  run: (task: ScheduledSubAgentTask, signal: AbortSignal, emit: (status: SubAgentStatus, detail?: string) => void) => Promise<SubAgentResult>
}

export async function runSubAgentTasks(tasks: ScheduledSubAgentTask[], options: SubAgentSchedulerOptions): Promise<SubAgentResult[]> {
  if (tasks.length > SUBAGENT_LIMITS.maxTasksPerCall) throw new Error(`Sub-agent 任务数不能超过 ${SUBAGENT_LIMITS.maxTasksPerCall}`)
  const concurrency = Math.max(1, Math.min(options.concurrency ?? SUBAGENT_LIMITS.maxParallelTasks, SUBAGENT_LIMITS.maxParallelTasks))
  const results: Array<SubAgentResult | undefined> = new Array(tasks.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const index = next++
      if (index >= tasks.length) return
      if (options.signal.aborted) {
        results[index] = {
          taskId: tasks[index].taskId,
          agentId: tasks[index].agentId,
          agentName: tasks[index].agentId,
          status: 'cancelled',
          output: '',
          truncated: false,
          startedAt: Date.now(),
          finishedAt: Date.now()
        }
        continue
      }
      const task = tasks[index]
      const controller = new AbortController()
      const abort = () => controller.abort()
      options.signal.addEventListener('abort', abort, { once: true })
      let timer: ReturnType<typeof setTimeout> | undefined
      let timedOut = false
      try {
        timer = setTimeout(() => { timedOut = true; controller.abort() }, SUBAGENT_LIMITS.maxRuntimeMs)
        const result = await options.run(task, controller.signal, (status, detail) => { void status; void detail })
        const bounded = truncateSubAgentOutput(result.output)
        results[index] = timedOut
          ? { ...result, status: 'timeout', error: `Sub-agent 运行超过 ${SUBAGENT_LIMITS.maxRuntimeMs}ms`, output: bounded.output, truncated: result.truncated || bounded.truncated }
          : { ...result, output: bounded.output, truncated: result.truncated || bounded.truncated }
      } catch (error) {
        timedOut = timedOut || (controller.signal.aborted && !options.signal.aborted)
        results[index] = {
          taskId: task.taskId,
          agentId: task.agentId,
          agentName: task.agentId,
          status: options.signal.aborted ? 'cancelled' : timedOut ? 'timeout' : 'failed',
          output: '',
          error: timedOut ? `Sub-agent 运行超过 ${SUBAGENT_LIMITS.maxRuntimeMs}ms` : error instanceof Error ? error.message : String(error),
          truncated: false,
          startedAt: Date.now(),
          finishedAt: Date.now()
        }
      } finally {
        if (timer) clearTimeout(timer)
        options.signal.removeEventListener('abort', abort)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return results.filter((result): result is SubAgentResult => Boolean(result))
}
