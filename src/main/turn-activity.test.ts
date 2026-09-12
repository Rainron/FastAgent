import { describe, expect, it } from 'vitest'
import type { AgentEvent, ExecutionSnapshot } from '../shared/types'
import { persistableEvent, stripEventExecutions } from './turn-activity'

const execution: ExecutionSnapshot = { runId: 'run-1', status: 'running', steps: [], events: [], activeStepId: null, activeEventId: null, activeThinkingId: null }

describe('persistableEvent', () => {
  it('去掉 execution，其余字段原样保留', () => {
    const event = { runId: 'run-1', type: 'tool_started', tool: 'read', timestamp: 1, execution } as AgentEvent
    const stored = persistableEvent(event)
    expect('execution' in stored).toBe(false)
    expect(stored).toMatchObject({ runId: 'run-1', type: 'tool_started', tool: 'read' })
  })

  it('没有 execution 时原样返回同一个引用', () => {
    const event = { runId: 'run-1', type: 'token', text: 'hi' } as AgentEvent
    expect(persistableEvent(event)).toBe(event)
  })
})

describe('stripEventExecutions', () => {
  it('只清事件副本，顶层快照与其他字段不动', () => {
    const activity = {
      status: 'done',
      startedAt: '2026-09-04T00:00:00.000Z',
      finishedAt: null,
      thinking: '想了想',
      execution,
      events: [{ type: 'tool_started', execution }, { type: 'completed', text: '好了', execution }]
    }
    const result = stripEventExecutions(activity)
    expect(result.stripped).toBe(2)
    const next = result.activity as typeof activity
    expect(next.execution).toEqual(execution)
    expect(next.thinking).toBe('想了想')
    expect(next.events.every((event) => !('execution' in event))).toBe(true)
    expect(next.events[1]).toMatchObject({ type: 'completed', text: '好了' })
  })

  it('没有可清理内容时不复制对象', () => {
    const activity = { status: 'done', events: [{ type: 'completed' }] }
    const result = stripEventExecutions(activity)
    expect(result.stripped).toBe(0)
    expect(result.activity).toBe(activity)
  })

  it('events 不是数组或输入不是对象时安全返回', () => {
    expect(stripEventExecutions(null).stripped).toBe(0)
    expect(stripEventExecutions({ events: 'nope' }).stripped).toBe(0)
  })
})
