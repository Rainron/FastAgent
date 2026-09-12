import { describe, expect, it } from 'vitest'
import { runSubAgentTasks } from './subagent-scheduler'

describe('subagent scheduler', () => {
  it('限制并发并保持输入顺序', async () => {
    let active = 0
    let peak = 0
    const results = await runSubAgentTasks([
      { taskId: 'a', agentId: 'scout', task: 'a' },
      { taskId: 'b', agentId: 'scout', task: 'b' },
      { taskId: 'c', agentId: 'scout', task: 'c' }
    ], {
      concurrency: 2,
      signal: new AbortController().signal,
      run: async (task) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active--
        return { taskId: task.taskId, agentId: task.agentId, agentName: 'scout', status: 'completed', output: task.task, truncated: false, startedAt: 0, finishedAt: 1 }
      }
    })
    expect(peak).toBe(2)
    expect(results.map((item) => item.taskId)).toEqual(['a', 'b', 'c'])
  })

  it('父级取消后保留未启动任务的取消结果', async () => {
    const controller = new AbortController()
    let started = 0
    const promise = runSubAgentTasks([
      { taskId: 'a', agentId: 'scout', task: 'a' },
      { taskId: 'b', agentId: 'scout', task: 'b' },
      { taskId: 'c', agentId: 'scout', task: 'c' }
    ], { concurrency: 1, signal: controller.signal, run: async (task, signal) => {
      started++
      await new Promise((resolve) => setTimeout(resolve, 10))
      if (signal.aborted) throw new Error('cancelled')
      return { taskId: task.taskId, agentId: task.agentId, agentName: 'scout', status: 'completed', output: '', truncated: false, startedAt: 0, finishedAt: 1 }
    } })
    controller.abort()
    const results = await promise
    expect(started).toBe(1)
    expect(results).toHaveLength(3)
    expect(results.every((item) => item.status === 'cancelled')).toBe(true)
  })

  it('链式任务按顺序执行并传播前序输出', async () => {
    const seen: string[] = []
    const tasks = [
      { taskId: 'a', agentId: 'scout', task: '第一步' },
      { taskId: 'b', agentId: 'reviewer', task: '第二步' }
    ]
    let previous = ''
    for (const task of tasks) {
      seen.push(`${task.task}:${previous}`)
      previous = task.task
    }
    expect(seen).toEqual(['第一步:', '第二步:第一步'])
  })

  it('隔离单个任务失败', async () => {
    const results = await runSubAgentTasks([{ taskId: 'a', agentId: 'scout', task: 'a' }], {
      signal: new AbortController().signal,
      run: async () => { throw new Error('失败') }
    })
    expect(results[0].status).toBe('failed')
    expect(results[0].error).toBe('失败')
  })
})
