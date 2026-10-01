import { describe, expect, it, vi } from 'vitest'
import { runSubAgentChain, runSubAgentTask, runSubAgentTasks } from './subagent-scheduler'
import { SUBAGENT_LIMITS } from './subagent-types'

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

  it('链式任务按顺序执行并只传播前序交接', async () => {
    const seen: string[] = []
    const results = await runSubAgentChain(
      [
        { taskId: 'a', agentId: 'scout', task: '第一步' },
        { taskId: 'b', agentId: 'reviewer', task: '第二步' }
      ],
      {
        signal: new AbortController().signal,
        run: async (task) => {
          seen.push(task.task)
          return { taskId: task.taskId, agentId: task.agentId, agentName: task.agentId, status: 'completed', output: '整段正文不该进下游', truncated: false, startedAt: 0, finishedAt: 1 }
        }
      },
      () => '## 关键发现\n- 交接摘要'
    )
    expect(results.map((item) => item.status)).toEqual(['completed', 'completed'])
    expect(seen[0]).toBe('第一步')
    expect(seen[1]).toContain('第二步')
    expect(seen[1]).toContain('交接摘要')
    // 前序全文最多 50k 字符，拼进下游 prompt 会让链条越长上下文膨胀越狠
    expect(seen[1]).not.toContain('整段正文不该进下游')
  })

  it('链式中途失败时，剩余任务也要有终态记录', async () => {
    const started: string[] = []
    const results = await runSubAgentChain(
      [
        { taskId: 'a', agentId: 'scout', task: 'a' },
        { taskId: 'b', agentId: 'scout', task: 'b' },
        { taskId: 'c', agentId: 'scout', task: 'c' }
      ],
      {
        signal: new AbortController().signal,
        run: async (task) => {
          started.push(task.taskId)
          if (task.taskId === 'a') throw new Error('炸了')
          return { taskId: task.taskId, agentId: task.agentId, agentName: task.agentId, status: 'completed', output: '', truncated: false, startedAt: 0, finishedAt: 1 }
        }
      },
      () => ''
    )
    expect(started).toEqual(['a'])
    // 原实现直接 break，b 与 c 既不执行也不回结果：模型看不出还有任务没跑，台账里也查不到
    expect(results.map((item) => [item.taskId, item.status])).toEqual([
      ['a', 'failed'],
      ['b', 'cancelled'],
      ['c', 'cancelled']
    ])
  })

  it('超过 maxRuntimeMs 的任务被判定为 timeout', async () => {
    vi.useFakeTimers()
    try {
      const promise = runSubAgentTask(
        { taskId: 'a', agentId: 'scout', task: 'a' },
        new AbortController().signal,
        (_task, signal) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      )
      await vi.advanceTimersByTimeAsync(SUBAGENT_LIMITS.maxRuntimeMs + 1)
      const result = await promise
      expect(result.status).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
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
