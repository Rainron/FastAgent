import { describe, expect, it } from 'vitest'
import { beginCompaction, cancelCompaction, completeCompaction, failCompaction, initialCompactionStates, type CompactionState } from './compaction-state'

describe('会话级压缩状态', () => {
  it('只为目标会话进入压缩中，不影响其它会话', () => {
    const states = initialCompactionStates()
    const next = beginCompaction(states, 'conversation-a', 1)

    expect(next['conversation-a']).toMatchObject({ status: 'running', modelId: 1, progress: 0 })
    expect(next['conversation-b']).toBeUndefined()
  })

  it('不同会话生成独立任务，取消后只影响目标会话', () => {
    const states = beginCompaction(beginCompaction({}, 'conversation-a', 1, 100), 'conversation-b', 2, 200)
    expect(states['conversation-a']?.taskId).not.toBe(states['conversation-b']?.taskId)
    const cancelled = cancelCompaction(states, 'conversation-a')
    expect(cancelled['conversation-a']).toMatchObject({ status: 'cancelled', phase: '已取消' })
    expect(cancelled['conversation-b']).toMatchObject({ status: 'running' })
  })

  it('完成或失败时只更新对应任务', () => {
    const states: Record<string, CompactionState> = {
      'conversation-a': { status: 'running', taskId: 'task-a', modelId: 1, progress: 35, phase: '生成摘要', startedAt: 100 }
    }
    const completed = completeCompaction(states, 'conversation-a')
    expect(completed['conversation-a']).toMatchObject({ status: 'success', progress: 100 })

    const failed = failCompaction(states, 'conversation-a', '请求超时')
    expect(failed['conversation-a']).toMatchObject({ status: 'timed_out', error: '请求超时' })
  })
})
