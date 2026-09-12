import { describe, expect, it } from 'vitest'
import { createExecutionState, reduceExecutionState, syncExecutionSteps, todoStatusToNode } from './execution-state'

describe('execution state', () => {
  it('adds plan steps created after the run starts without resetting active state', () => {
    let state = createExecutionState('run-1', [{ id: 'step-1', content: '读取代码', status: 'pending', position: 0 }])
    state = reduceExecutionState(state, { type: 'tool_started', eventId: 'event-1', stepId: 'step-1', toolCallId: 'call-1', timestamp: 10 })
    state = syncExecutionSteps(state, [
      { id: 'step-1', content: '读取代码', status: 'in_progress', position: 0 },
      { id: 'step-2', content: '修改代码', status: 'pending', position: 1 }
    ])

    expect(state.activeStepId).toBe('step-1')
    expect(state.steps.map((step) => step.id)).toEqual(['step-1', 'step-2'])
    expect(state.steps[0].status).toBe('running')
  })

  it('starts the first step when an execution event arrives', () => {
    let state = createExecutionState('run-1', [
      { id: 'step-1', content: '读取代码', status: 'pending', position: 0 },
      { id: 'step-2', content: '修改代码', status: 'pending', position: 1 }
    ])

    state = reduceExecutionState(state, { type: 'tool_started', eventId: 'event-1', stepId: 'step-1', toolCallId: 'call-1', timestamp: 10 })

    expect(state.activeStepId).toBe('step-1')
    expect(state.steps.map((step) => step.status)).toEqual(['running', 'pending'])
    expect(state.events[0]).toMatchObject({ eventId: 'event-1', status: 'running', stepId: 'step-1' })
  })

  it('settles thinking when a tool starts', () => {
    let state = createExecutionState('run-1', [{ id: 'step-1', content: '执行', status: 'pending', position: 0 }])
    state = reduceExecutionState(state, { type: 'thinking_started', eventId: 'thinking-event', stepId: 'step-1', thinkingId: 'thinking-1', timestamp: 10 })
    state = reduceExecutionState(state, { type: 'tool_started', eventId: 'tool-event', stepId: 'step-1', toolCallId: 'call-1', timestamp: 20 })

    expect(state.activeThinkingId).toBeNull()
    expect(state.events.find((event) => event.eventId === 'thinking-event')?.status).toBe('completed')
    expect(state.activeEventId).toBe('tool-event')
  })

  it('completes the current step and advances to the next one after its event completes', () => {
    let state = createExecutionState('run-1', [
      { id: 'step-1', content: '读取代码', status: 'pending', position: 0 },
      { id: 'step-2', content: '修改代码', status: 'pending', position: 1 }
    ])
    state = reduceExecutionState(state, { type: 'tool_started', eventId: 'event-1', stepId: 'step-1', toolCallId: 'call-1', timestamp: 10 })
    state = reduceExecutionState(state, { type: 'tool_result', eventId: 'event-1', stepId: 'step-1', toolCallId: 'call-1', status: 'completed', timestamp: 20 })

    expect(state.steps.map((step) => step.status)).toEqual(['completed', 'running'])
    expect(state.activeStepId).toBe('step-2')
  })

  it('settles thinking when assistant content starts', () => {
    let state = createExecutionState('run-1', [{ id: 'step-1', content: '回答', status: 'pending', position: 0 }])
    state = reduceExecutionState(state, { type: 'thinking_started', eventId: 'event-1', stepId: 'step-1', thinkingId: 'thinking-1', timestamp: 10 })
    state = reduceExecutionState(state, { type: 'assistant_content_started', stepId: 'step-1', timestamp: 20 })

    expect(state.activeThinkingId).toBeNull()
    expect(state.events[0].status).toBe('completed')
  })

  it('settles all active nodes when the run reaches a terminal state', () => {
    let state = createExecutionState('run-1', [{ id: 'step-1', content: '执行', status: 'pending', position: 0 }])
    state = reduceExecutionState(state, { type: 'thinking_started', eventId: 'event-1', stepId: 'step-1', thinkingId: 'thinking-1', timestamp: 10 })
    state = reduceExecutionState(state, { type: 'run_completed', timestamp: 20 })

    expect(state.status).toBe('completed')
    expect(state.activeStepId).toBeNull()
    expect(state.activeEventId).toBeNull()
    expect(state.activeThinkingId).toBeNull()
    expect(state.steps.every((step) => step.status !== 'running')).toBe(true)
    expect(state.events.every((event) => event.status !== 'running')).toBe(true)
  })
})

describe('todoStatusToNode', () => {
  it('blocked 仍算待执行：暂时推不动不等于已结算', () => {
    expect(todoStatusToNode('blocked')).toBe('pending')
    expect(todoStatusToNode('pending')).toBe('pending')
    // in_progress 的 running 由 reducer 推进，不从待办直接置位
    expect(todoStatusToNode('in_progress')).toBe('pending')
  })

  it('skipped 与 cancelled 都归入不会再执行', () => {
    expect(todoStatusToNode('skipped')).toBe('cancelled')
    expect(todoStatusToNode('cancelled')).toBe('cancelled')
  })

  it('completed 与 failed 各自保留', () => {
    expect(todoStatusToNode('completed')).toBe('completed')
    expect(todoStatusToNode('failed')).toBe('failed')
  })

  it('新态进入初始步骤时按映射落位', () => {
    const state = createExecutionState('run-1', [
      { id: 's1', content: '阻塞', status: 'blocked', position: 0 },
      { id: 's2', content: '跳过', status: 'skipped', position: 1 },
      { id: 's3', content: '失败', status: 'failed', position: 2 }
    ])
    expect(state.steps.map((step) => step.status)).toEqual(['pending', 'cancelled', 'failed'])
  })
})
