import { describe, expect, it } from 'vitest'
import { createExecutionState } from '../agent/execution-state'
import { executionInputForEvent } from './execution-input'

const state = (patch: Partial<ReturnType<typeof createExecutionState>> = {}) => ({
  ...createExecutionState('run-1', []),
  ...patch
})

describe('executionInputForEvent', () => {
  it('三种终态事件各自映射到对应的轨迹终态', () => {
    for (const [type, expected] of [['completed', 'run_completed'], ['failed', 'run_failed'], ['cancelled', 'run_cancelled'], ['interrupted', 'run_cancelled']] as const) {
      expect(executionInputForEvent({ type } as never, 100, state())).toEqual({ type: expected, timestamp: 100 })
    }
  })

  it('思考中收到 token 才切成正文开始，没有活跃思考时不产生输入', () => {
    expect(executionInputForEvent({ type: 'token' } as never, 7, state({ activeThinkingId: 'think-1', activeStepId: 'step-1' }))).toEqual({
      type: 'assistant_content_started',
      eventId: 'run-1:assistant-content:7',
      stepId: 'step-1',
      thinkingId: 'think-1',
      timestamp: 7
    })
    expect(executionInputForEvent({ type: 'token' } as never, 7, state())).toBeNull()
  })

  it('thinking_started 没带 eventId 时用 runId + 时间戳兜底，thinking_ended 回落到当前活跃思考', () => {
    expect(executionInputForEvent({ type: 'thinking_started' } as never, 3, state())).toMatchObject({
      type: 'thinking_started',
      eventId: 'run-1:thinking:3',
      thinkingId: 'run-1:thinking:3'
    })
    expect(executionInputForEvent({ type: 'thinking_ended' } as never, 4, state({ activeThinkingId: 'think-9' }))).toMatchObject({
      type: 'thinking_ended',
      eventId: 'think-9',
      thinkingId: 'think-9'
    })
  })

  it('工具事件的 eventId 优先用 toolCallId，tool_result 默认记完成', () => {
    expect(executionInputForEvent({ type: 'tool_started', toolCallId: 'call-1' } as never, 5, state())).toMatchObject({
      type: 'tool_started',
      eventId: 'tool:call-1',
      toolCallId: 'call-1',
      status: undefined
    })
    expect(executionInputForEvent({ type: 'tool_result', toolCallId: 'call-1' } as never, 6, state())).toMatchObject({ status: 'completed' })
    expect(executionInputForEvent({ type: 'tool_result', toolCallId: 'call-1', status: 'failed' } as never, 6, state())).toMatchObject({ status: 'failed' })
    expect(executionInputForEvent({ type: 'tool_result', toolCallId: 'call-1', status: 'cancelled' } as never, 6, state())).toMatchObject({ status: 'cancelled' })
  })

  it('不参与轨迹的事件返回 null', () => {
    expect(executionInputForEvent({ type: 'run_phase' } as never, 1, state())).toBeNull()
  })
})
