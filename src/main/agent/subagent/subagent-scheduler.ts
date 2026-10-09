import type { SubAgentResult, SubAgentStatus } from './subagent-types'
import { SUBAGENT_LIMITS } from './subagent-types'
import { truncateSubAgentOutput } from './subagent-handoff'
import type { WriteTarget } from './workspace-gate'

export interface ScheduledSubAgentTask {
  taskId: string
  agentId: string
  task: string
  /** 角色是否可写：可写子任务要等同批主 Agent 的写操作，并按文件认领写入目标。 */
  canWrite?: boolean
  /**
   * 写入前认领目标文件；返回拒绝原因，null 表示可以写。
   * 由 subagent 工具按工作区闸门生成，经子运行的工具钩子调用。
   */
  claimWrite?: (targets: WriteTarget[]) => string | null
}

export type SubAgentRunner = (task: ScheduledSubAgentTask, signal: AbortSignal) => Promise<SubAgentResult>

export interface SubAgentSchedulerOptions {
  concurrency?: number
  signal: AbortSignal
  run: SubAgentRunner
}

/** 没有真正跑起来的任务也要有终态结果：调用方靠结果条数判断「是不是每个任务都有交代」。 */
export function settledSubAgentResult(
  task: ScheduledSubAgentTask,
  status: Exclude<SubAgentStatus, 'queued' | 'running'>,
  error?: string
): SubAgentResult {
  const now = Date.now()
  return {
    taskId: task.taskId,
    agentId: task.agentId,
    agentName: task.agentId,
    status,
    output: '',
    ...(error ? { error } : {}),
    truncated: false,
    startedAt: now,
    finishedAt: now
  }
}

/**
 * 单个子任务的超时与失败归一。
 *
 * 并行与链式必须共用这一份：超时定时器原本只挂在并发工作线里，链式路径直接调 run，
 * maxRuntimeMs 在那条路上等于不存在，卡住的链式子任务只能靠用户手动停止。
 */
export async function runSubAgentTask(
  task: ScheduledSubAgentTask,
  parentSignal: AbortSignal,
  run: SubAgentRunner
): Promise<SubAgentResult> {
  if (parentSignal.aborted) return settledSubAgentResult(task, 'cancelled')
  const controller = new AbortController()
  const abort = () => controller.abort()
  parentSignal.addEventListener('abort', abort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  try {
    timer = setTimeout(() => { timedOut = true; controller.abort() }, SUBAGENT_LIMITS.maxRuntimeMs)
    const result = await run(task, controller.signal)
    const bounded = truncateSubAgentOutput(result.output)
    return timedOut
      ? { ...result, status: 'timeout', error: `Sub-agent 运行超过 ${SUBAGENT_LIMITS.maxRuntimeMs}ms`, output: bounded.output, truncated: result.truncated || bounded.truncated }
      : { ...result, output: bounded.output, truncated: result.truncated || bounded.truncated }
  } catch (error) {
    // 子运行的 signal 在「用户停止」与「本任务超时」两种情况下都会 abort，
    // 只有父运行的 signal 能区分二者。
    timedOut = timedOut || (controller.signal.aborted && !parentSignal.aborted)
    const status = parentSignal.aborted ? 'cancelled' : timedOut ? 'timeout' : 'failed'
    return settledSubAgentResult(
      task,
      status,
      timedOut ? `Sub-agent 运行超过 ${SUBAGENT_LIMITS.maxRuntimeMs}ms` : error instanceof Error ? error.message : String(error)
    )
  } finally {
    if (timer) clearTimeout(timer)
    parentSignal.removeEventListener('abort', abort)
  }
}

/**
 * 并行执行一组子任务。
 *
 * 用工作池而不是整批 Promise.all：一个慢任务不该把同批次其他任务的额度一起占住。
 */
async function runSubAgentPool(tasks: ScheduledSubAgentTask[], options: SubAgentSchedulerOptions): Promise<SubAgentResult[]> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? SUBAGENT_LIMITS.maxParallelTasks, SUBAGENT_LIMITS.maxParallelTasks))
  const results: Array<SubAgentResult | undefined> = new Array(tasks.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const index = next++
      if (index >= tasks.length) return
      results[index] = await runSubAgentTask(tasks[index], options.signal, options.run)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return results.filter((result): result is SubAgentResult => Boolean(result))
}

/**
 * 并行委派：只读与可写子任务一律并行，结果顺序与入参一致。
 *
 * 可写子任务之间的冲突不在这里排队解决，而是由 WorkspaceGate 按文件认领：
 * 整体独占会让五个各写一个文件的任务也只能一个接一个跑。
 */
export async function runSubAgentTasks(tasks: ScheduledSubAgentTask[], options: SubAgentSchedulerOptions): Promise<SubAgentResult[]> {
  if (tasks.length > SUBAGENT_LIMITS.maxTasksPerCall) throw new Error(`Sub-agent 任务数不能超过 ${SUBAGENT_LIMITS.maxTasksPerCall}`)
  return runSubAgentPool(tasks, options)
}

/**
 * 链式执行：前一个任务的**结构化交接**作为后一个任务的输入。
 *
 * 中途失败必须为剩余任务补终态结果，否则模型看到的结果里完全看不出还有任务没跑，
 * 台账里也查不到——与中止分支的行为对齐。
 */
export async function runSubAgentChain(
  tasks: ScheduledSubAgentTask[],
  options: SubAgentSchedulerOptions,
  describeContext: (previous: SubAgentResult) => string
): Promise<SubAgentResult[]> {
  if (tasks.length > SUBAGENT_LIMITS.maxTasksPerCall) throw new Error(`Sub-agent 任务数不能超过 ${SUBAGENT_LIMITS.maxTasksPerCall}`)
  const results: SubAgentResult[] = []
  let context = ''
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index]
    if (options.signal.aborted) {
      results.push(settledSubAgentResult(task, 'cancelled'))
      continue
    }
    const result = await runSubAgentTask(
      context ? { ...task, task: `${task.task}\n\n${context}` } : task,
      options.signal,
      options.run
    )
    results.push(result)
    if (result.status !== 'completed') {
      for (const skipped of tasks.slice(index + 1)) {
        results.push(settledSubAgentResult(skipped, 'cancelled', '前序 Sub-agent 未完成，已跳过'))
      }
      break
    }
    context = describeContext(result)
  }
  return results
}
