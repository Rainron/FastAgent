import { describe, expect, it } from 'vitest'
import type { AgentEvent, ToolCallRecord } from '../../shared/types'
import { buildExecutionTrace } from '../execution-trace'
import { collectSubAgents, findSubAgent, formatCallDuration, handoffSections, stripHandoffPrompt, subAgentElapsedMs, subAgentRowState, subAgentTaskPreview, subAgentToolCalls, toolCallArgumentPreview, type SubAgentAction } from './subagent-view'

const event = (patch: Partial<AgentEvent>): AgentEvent => ({ runId: 'r1', type: 'run_phase', ...patch })
const sub = (taskId: string, agentName: string, patch: Partial<AgentEvent>): AgentEvent => event({
  subAgent: { taskId, agentId: agentName, agentName, status: 'running' },
  ...patch
})

const action = (patch: Partial<SubAgentAction>): SubAgentAction => ({ kind: 'subagent', taskId: 't1', agentName: 'scout', task: null, status: 'running', activity: null, toolCount: 0, ...patch })

const record = (patch: Partial<ToolCallRecord>): ToolCallRecord => ({
  id: 'c1', conversationId: 'conv', turnId: 'turn', runId: 'r', toolName: 'read', arguments: {}, result: null,
  status: 'success', permissionResult: null, startedAt: '2026-10-01T10:00:00.000Z', finishedAt: null, durationMs: null, error: null,
  ...patch
})

describe('collectSubAgents', () => {
  it('跨动作组按委派顺序收集，同一任务只出现一次', () => {
    const trace = buildExecutionTrace([
      sub('t1', 'scout', { type: 'subagent_started', input: '调查 A' }),
      sub('t2', 'reviewer', { type: 'subagent_started', input: '审查 B' }),
      sub('t1', 'scout', { type: 'subagent_update', tool: 'read', status: 'running' })
    ])
    expect(collectSubAgents(trace).map((item) => item.agentName)).toEqual(['scout', 'reviewer'])
    expect(findSubAgent(trace, 't2')?.task).toBe('审查 B')
    expect(findSubAgent(trace, 'nope')).toBeNull()
  })

  it('没有子代理时为空', () => {
    expect(collectSubAgents(buildExecutionTrace([event({ type: 'tool_started', tool: 'read', toolCallId: 'c1' })]))).toEqual([])
  })
})

describe('subAgentRowState / subAgentElapsedMs', () => {
  it('waiting 也算在跑，failed 单列', () => {
    expect(subAgentRowState(action({ status: 'waiting' }))).toBe('running')
    expect(subAgentRowState(action({ status: 'failed' }))).toBe('failed')
    expect(subAgentRowState(action({ status: 'done' }))).toBe('done')
  })

  it('执行中按当前时间计，终态按结束时间计', () => {
    expect(subAgentElapsedMs(action({ startedAt: 1000 }), 4000)).toBe(3000)
    expect(subAgentElapsedMs(action({ status: 'done', startedAt: 1000, finishedAt: 2500 }), 9000)).toBe(1500)
  })

  it('回合已结束但子代理没收到终态时用回合结束时间封顶', () => {
    expect(subAgentElapsedMs(action({ startedAt: 1000 }), 99_000, 5000)).toBe(4000)
  })

  it('拿不到起点或终点时返回 null', () => {
    expect(subAgentElapsedMs(action({}), 4000)).toBeNull()
    expect(subAgentElapsedMs(action({ status: 'done', startedAt: 1000 }), 4000)).toBeNull()
  })
})

describe('任务文本', () => {
  it('去掉系统追加的交接模板', () => {
    expect(stripHandoffPrompt('统计行数\n\n请严格按以下格式交接，区分事实：\n## 目标')).toBe('统计行数')
    expect(stripHandoffPrompt(null)).toBe('')
  })

  it('预览取首个非空行并截断', () => {
    expect(subAgentTaskPreview('\n\n  只读调查项目\n第二行')).toBe('只读调查项目')
    expect(subAgentTaskPreview('x'.repeat(100), 10)).toBe(`${'x'.repeat(10)}…`)
  })
})

describe('subAgentToolCalls', () => {
  it('只取该子运行的调用并按开始时间排序', () => {
    const records = [
      record({ id: 'b', subAgentRunId: 'child', startedAt: '2026-10-01T10:00:02.000Z' }),
      record({ id: 'x', subAgentRunId: 'other' }),
      record({ id: 'a', subAgentRunId: 'child', startedAt: '2026-10-01T10:00:01.000Z' }),
      record({ id: 'main' })
    ]
    expect(subAgentToolCalls(records, 'child').map((item) => item.id)).toEqual(['a', 'b'])
    expect(subAgentToolCalls(records, undefined)).toEqual([])
  })
})

describe('toolCallArgumentPreview', () => {
  it('搜索带关键字和路径时显示关键字', () => {
    expect(toolCallArgumentPreview(record({ arguments: { pattern: 'TODO', path: 'src' } }))).toBe('TODO')
  })

  it('路径与命令优先', () => {
    expect(toolCallArgumentPreview(record({ arguments: { path: 'src/a.ts', offset: 3 } }))).toBe('src/a.ts')
    expect(toolCallArgumentPreview(record({ arguments: { command: 'npm test\necho done' } }))).toBe('npm test')
  })

  it('其余给截短的 JSON，空入参给空串', () => {
    expect(toolCallArgumentPreview(record({ arguments: { a: 1 } }))).toBe('{"a":1}')
    expect(toolCallArgumentPreview(record({ arguments: {} }))).toBe('')
    expect(toolCallArgumentPreview(record({ arguments: { a: 'x'.repeat(300) } })).endsWith('…')).toBe(true)
  })
})

describe('formatCallDuration', () => {
  it('不足一秒给毫秒，一分钟内保留一位小数', () => {
    expect(formatCallDuration(42)).toBe('42ms')
    expect(formatCallDuration(1530)).toBe('1.5秒')
    expect(formatCallDuration(125_000)).toBe('2分5秒')
    expect(formatCallDuration(null)).toBe('')
  })
})

describe('handoffSections', () => {
  it('空段落不出，旧记录缺字段不报错', () => {
    const sections = handoffSections({ goal: '统计', verified: ['A'], unverified: [], findings: [], decisions: undefined as never, recommendations: [], remainingSteps: ['B'] })
    expect(sections.map((section) => section.title)).toEqual(['目标', '已验证', '剩余步骤'])
    expect(handoffSections(undefined)).toEqual([])
  })
})
