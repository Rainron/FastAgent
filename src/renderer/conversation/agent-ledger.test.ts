import { describe, expect, it } from 'vitest'
import type { AgentTaskRecord } from '../../shared/types'
import { agentRunStatusLabel, agentTaskStatusLabel, describeTally, runDurationMs, tallyTasks, taskDurationMs } from './agent-ledger'

function task(patch: Partial<AgentTaskRecord> & { taskId: string }): AgentTaskRecord {
  return {
    runId: 'run-1', conversationId: 'c1', turnId: 't1', parentToolCallId: null, subAgentRunId: null,
    agentId: 'scout', agentName: 'scout', goal: '定位调用链', status: 'completed', summary: null,
    error: null, startedAt: 1_000, finishedAt: 2_000, durationMs: 1_000, ...patch
  }
}

describe('状态文案', () => {
  it('运行与任务的中断、超时各有独立说法', () => {
    expect(agentRunStatusLabel('interrupted')).toBe('已中断')
    expect(agentTaskStatusLabel('timeout')).toBe('超时')
    expect(agentTaskStatusLabel('cancelled')).toBe('已取消')
  })
})

describe('耗时', () => {
  it('落库耗时优先，执行中的任务按当前时间现算', () => {
    expect(taskDurationMs(task({ taskId: 'a' }), 9_999)).toBe(1_000)
    expect(taskDurationMs(task({ taskId: 'b', durationMs: null, finishedAt: null, startedAt: 1_000 }), 4_000)).toBe(3_000)
  })

  it('运行未收尾时同样按当前时间现算，不会出现负数', () => {
    expect(runDurationMs({ startedAt: 1_000, finishedAt: null }, 5_000)).toBe(4_000)
    expect(runDurationMs({ startedAt: 5_000, finishedAt: 1_000 }, 9_000)).toBe(0)
  })
})

describe('tallyTasks', () => {
  it('超时与取消都算未完成', () => {
    const tally = tallyTasks([
      task({ taskId: 'a', status: 'completed' }),
      task({ taskId: 'b', status: 'timeout' }),
      task({ taskId: 'c', status: 'cancelled' }),
      task({ taskId: 'd', status: 'running' })
    ])
    expect(tally).toEqual({ total: 4, completed: 1, failed: 2, running: 1 })
  })

  it('空清单给出明确文案，不显示 0 个任务', () => {
    expect(describeTally(tallyTasks([]))).toBe('无委派任务')
  })

  it('文案只列出非零项', () => {
    expect(describeTally(tallyTasks([task({ taskId: 'a' })]))).toBe('1 个任务 · 1 完成')
  })
})
