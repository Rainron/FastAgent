import { describe, expect, it } from 'vitest'
import { forwardSubAgentEvent, isSubAgentPassthroughEvent, isSubAgentTerminalEvent, SUBAGENT_MAX_FORWARDED_EVENTS, type SubAgentForwardContext } from './subagent-events'

const context: SubAgentForwardContext = {
  taskId: 'subtask-1',
  agentId: 'scout',
  agentName: 'scout',
  parentToolCallId: 'call-1',
  parentRunId: 'run-parent',
  subAgentRunId: 'run-child'
}

describe('forwardSubAgentEvent', () => {
  it('丢弃流式事件，避免每个 token 都触发父回合落库', () => {
    expect(forwardSubAgentEvent({ type: 'token', text: 'a' }, context, 0)).toBeNull()
    expect(forwardSubAgentEvent({ type: 'thinking', text: 'a' }, context, 0)).toBeNull()
    expect(forwardSubAgentEvent({ type: 'thinking_started' }, context, 0)).toBeNull()
    expect(forwardSubAgentEvent({ type: 'thinking_ended' }, context, 0)).toBeNull()
  })

  it('丢弃上下文与用量快照：它们每 250ms 一条，会耗尽转发配额让工具进度丢失', () => {
    expect(forwardSubAgentEvent({ type: 'contextProgress' }, context, 0)).toBeNull()
    expect(forwardSubAgentEvent({ type: 'contextUpdated' }, context, 0)).toBeNull()
    expect(forwardSubAgentEvent({ type: 'usageUpdated' }, context, 0)).toBeNull()
  })

  it('工具事件转成 subagent_update 并带上任务身份', () => {
    const event = forwardSubAgentEvent({ type: 'tool_started', tool: 'read', toolCallId: 'child-call' }, context, 0)
    expect(event?.type).toBe('subagent_update')
    expect(event?.tool).toBe('read')
    // toolCallId 必须是父工具调用，轨迹按父调用聚合 Sub-agent 卡片
    expect(event?.toolCallId).toBe('call-1')
    expect(event?.subAgent).toMatchObject({ taskId: 'subtask-1', agentId: 'scout', parentRunId: 'run-parent', subAgentRunId: 'run-child', status: 'running' })
  })

  it('工具开始事件带截短的入参，结果事件不带', () => {
    expect(forwardSubAgentEvent({ type: 'tool_started', tool: 'read', input: 'src/App.tsx' }, context, 0)?.input).toBe('src/App.tsx')
    const long = forwardSubAgentEvent({ type: 'tool_started', tool: 'bash', input: 'x'.repeat(500) }, context, 0)?.input ?? ''
    expect(long.length).toBeLessThan(200)
    expect(long.endsWith('…')).toBe(true)
    expect(forwardSubAgentEvent({ type: 'tool_result', tool: 'read', input: 'src/App.tsx', status: 'completed' }, context, 0)?.input).toBeUndefined()
  })

  it('终态事件映射到对应的 subagent_* 类型并补齐状态', () => {
    expect(forwardSubAgentEvent({ type: 'completed', text: 'out' }, context, 0)?.type).toBe('subagent_result')
    expect(forwardSubAgentEvent({ type: 'failed', detail: 'boom' }, context, 0)?.type).toBe('subagent_failed')
    expect(forwardSubAgentEvent({ type: 'cancelled' }, context, 0)?.type).toBe('subagent_cancelled')
    expect(forwardSubAgentEvent({ type: 'interrupted' }, context, 0)?.type).toBe('subagent_cancelled')
    expect(forwardSubAgentEvent({ type: 'cancelled' }, context, 0)?.subAgent?.status).toBe('cancelled')
    expect(forwardSubAgentEvent({ type: 'completed', text: 'out' }, context, 0)?.subAgent?.status).toBe('completed')
  })

  it('终态事件不携带子 Agent 正文：全文只经工具返回值交给模型', () => {
    const event = forwardSubAgentEvent({ type: 'completed', text: 'x'.repeat(1000) }, context, 0)
    expect(event?.text).toBeUndefined()
    expect(JSON.stringify(event)).not.toContain('xxx')
  })

  it('非终态事件受配额限制', () => {
    expect(forwardSubAgentEvent({ type: 'tool_started' }, context, SUBAGENT_MAX_FORWARDED_EVENTS - 1)).not.toBeNull()
    expect(forwardSubAgentEvent({ type: 'tool_started' }, context, SUBAGENT_MAX_FORWARDED_EVENTS)).toBeNull()
  })

  it('终态事件不受配额限制，否则卡片永远停在执行中', () => {
    expect(forwardSubAgentEvent({ type: 'completed' }, context, SUBAGENT_MAX_FORWARDED_EVENTS * 10)?.type).toBe('subagent_result')
  })

  it('落盘事件原样转发：折叠后 path 与增删行会丢，产物面板就看不到子 Agent 的写入', () => {
    const changed = { type: 'file_changed' as const, path: 'src/a.ts', detail: 'write', additions: 3, deletions: 1 }
    expect(forwardSubAgentEvent(changed, context, SUBAGENT_MAX_FORWARDED_EVENTS * 10)).toEqual(changed)
  })
})

describe('isSubAgentPassthroughEvent', () => {
  it('只有落盘事件原样转发', () => {
    expect(isSubAgentPassthroughEvent('file_changed')).toBe(true)
    expect(isSubAgentPassthroughEvent('tool_started')).toBe(false)
    expect(isSubAgentPassthroughEvent('completed')).toBe(false)
  })
})

describe('isSubAgentTerminalEvent', () => {
  it('识别子运行终态', () => {
    expect(isSubAgentTerminalEvent('completed')).toBe(true)
    expect(isSubAgentTerminalEvent('interrupted')).toBe(true)
    expect(isSubAgentTerminalEvent('tool_result')).toBe(false)
  })
})
