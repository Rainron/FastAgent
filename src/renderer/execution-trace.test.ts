import { describe, expect, it } from 'vitest'
import { buildExecutionTrace, formatElapsed, isDelegationToolAction, subAgentActivityLabel, thinkingTextByGroup, traceGroupLabel, traceGroupLiveLabel } from './execution-trace'
import type { AgentEvent } from '../shared/types'

function event(patch: Partial<AgentEvent>): AgentEvent {
  return { runId: 'run-1', type: 'tool_started', timestamp: 0, sequence: 0, ...patch }
}

function readStarted(textLength?: number): AgentEvent {
  return event({ type: 'tool_started', tool: 'read', toolCallId: 'c1', input: 'src/a.ts', textLength })
}

function readResult(textLength?: number, status: 'completed' | 'failed' = 'completed'): AgentEvent {
  return event({ type: 'tool_result', tool: 'read', toolCallId: 'c1', status, durationMs: 12, textLength })
}

function grepStarted(textLength?: number): AgentEvent {
  return event({ type: 'tool_started', tool: 'grep', toolCallId: 'c2', input: 'mount', textLength })
}

function grepResult(textLength: number): AgentEvent {
  return event({ type: 'tool_result', tool: 'grep', toolCallId: 'c2', status: 'completed', textLength })
}

const thinkingOn = event({ type: 'thinking_started' })
const thinkingOff = event({ type: 'thinking_ended' })
const completed = event({ type: 'completed', text: '...', status: 'completed', textLength: 90 })

describe('buildExecutionTrace', () => {
  it('纯问答（无工具）把整段正文留给正文区，不产生轨迹', () => {
    const trace = buildExecutionTrace([thinkingOn, thinkingOff, completed])
    expect(trace.segments).toHaveLength(1)
    expect(trace.segments[0]).toMatchObject({ kind: 'group' })
    expect(trace.answerStart).toBe(0)
  })

  it('动作组之间出现正文时切出文本段，answerStart 指向最后一段起点', () => {
    const trace = buildExecutionTrace([
      thinkingOn, thinkingOff,
      readStarted(0),
      readResult(5),                      // 模型随后输出 5 个字符说明
      grepStarted(5),                     // textLength 5 → 切分文本 [0,5) 并归档上一组
      grepResult(5),
      completed
    ])
    expect(trace.segments).toEqual([
      { kind: 'group', group: expect.objectContaining({ status: 'done' }) },
      { kind: 'text', start: 0, end: 5 },
      { kind: 'group', group: expect.objectContaining({ status: 'done' }) }
    ])
    expect(trace.answerStart).toBe(5)
  })

  it('相邻工具且无正文输出时聚合到同一组', () => {
    const trace = buildExecutionTrace([
      readStarted(0), readResult(0),
      grepStarted(0), grepResult(0),
      completed
    ])
    expect(trace.segments).toHaveLength(1)
    const group = trace.segments[0]
    expect(group.kind).toBe('group')
    if (group.kind === 'group') {
      expect(group.group.actions).toHaveLength(2)
      expect(group.group.status).toBe('done')
    }
    expect(trace.answerStart).toBe(0)
  })

  it('中间说明文本已归档，终态输出则留给正文区', () => {
    const trace = buildExecutionTrace([
      readStarted(0), readResult(40),
      grepStarted(40), grepResult(40),
      completed
    ])
    expect(trace.segments.map((segment) => segment.kind)).toEqual(['group', 'text', 'group'])
    // [0,40) 是 read 完成后的中间说明已归档；40 之后的最终回答留在正文区。
    expect(trace.answerStart).toBe(40)
  })

  it('终态与中间事件都没有新增正文时，不产生文本段', () => {
    const trace = buildExecutionTrace([
      readStarted(0), readResult(0),
      grepStarted(0), grepResult(0),
      completed
    ])
    expect(trace.segments).toHaveLength(1)
    expect(trace.answerStart).toBe(0)
  })

  it('失败的工具调用使组状态落为 failed', () => {
    const trace = buildExecutionTrace([readStarted(0), readResult(0, 'failed'), completed])
    const group = trace.segments[0]
    if (group.kind === 'group') expect(group.group.status).toBe('failed')
  })

  it('通过一次性 tool_result 补齐动作（result 先于 started 的异常顺序）', () => {
    const trace = buildExecutionTrace([
      event({ type: 'tool_result', tool: 'edit', toolCallId: 'c9', status: 'completed', textLength: 0 }),
      completed
    ])
    expect(trace.segments).toHaveLength(1)
    const group = trace.segments[0]
    if (group.kind === 'group') expect(group.group.actions).toHaveLength(1)
  })

  it('旧数据没有 textLength：无法切分，全部动作归并到一组，正文区全文', () => {
    const legacy = [
      readStarted(), readResult(),
      grepStarted(),
      event({ type: 'tool_result', tool: 'grep', toolCallId: 'c2', status: 'completed' }),
      completed
    ].map((item) => { const { textLength: _drop, ...rest } = item; return rest })
    const trace = buildExecutionTrace(legacy)
    expect(trace.segments).toHaveLength(1)
    expect(trace.segments[0].kind).toBe('group')
    expect(trace.answerStart).toBe(0)
  })

  it('终态之后的清理事件不切分正文，最终回答留在正文区', () => {
    const trace = buildExecutionTrace([
      readStarted(0), readResult(0),
      completed,
      event({ type: 'run_phase', phase: 'cleanup', detail: '运行清理完成', status: 'completed', textLength: 90 }),
      event({ type: 'contextUpdated', textLength: 90 })
    ])
    expect(trace.segments).toHaveLength(1)
    expect(trace.answerStart).toBe(0)
  })

  it('同一组内多轮思考各自结算，不会把组卡在 running', () => {
    const trace = buildExecutionTrace([
      thinkingOn, thinkingOff,
      readStarted(0), readResult(0),
      thinkingOn, thinkingOff,
      grepStarted(0), grepResult(0),
      completed
    ])
    const group = trace.segments[0]
    expect(group.kind).toBe('group')
    if (group.kind === 'group') {
      expect(group.group.actions.filter((action) => action.status === 'running')).toHaveLength(0)
      expect(group.group.status).toBe('done')
    }
  })

  it('运行中（无终态事件）的组保留为 pendingGroup', () => {
    const trace = buildExecutionTrace([thinkingOn, readStarted(0)])
    expect(trace.segments).toHaveLength(0)
    expect(trace.pendingGroup).not.toBeNull()
    // read 尚未返回，组保持 running。
    expect(trace.pendingGroup?.status).toBe('running')
    expect(trace.answerStart).toBe(0)
  })

  it('工具调用即结算先前的 Thinking：工具全部完成后组立即落为 done', () => {
    // 主进程在 run 开始就预发 thinking_started，模型不产出 thinking block 时不会有 thinking_ended。
    const trace = buildExecutionTrace([thinkingOn, readStarted(0), readResult(0)])
    expect(trace.pendingGroup?.actions[0]).toEqual({ kind: 'thinking', status: 'done' })
    expect(trace.pendingGroup?.status).toBe('done')
  })

  it('正文分段归档上一组时结算未完成动作，历史组不再显示 running', () => {
    const trace = buildExecutionTrace([thinkingOn, readStarted(0), grepStarted(12), grepResult(12), completed])
    const first = trace.segments[0]
    expect(first.kind).toBe('group')
    if (first.kind === 'group') {
      expect(first.group.status).toBe('done')
      expect(first.group.actions.some((action) => action.status === 'running' || action.status === 'waiting')).toBe(false)
    }
  })

  it('取消时在飞的工具收敛为 failed，不再转圈', () => {
    const trace = buildExecutionTrace([readStarted(0), event({ type: 'cancelled', detail: '已取消' })])
    expect(trace.pendingGroup).toBeNull()
    const group = trace.segments[0]
    expect(group.kind).toBe('group')
    if (group.kind === 'group') {
      expect(group.group.actions[0].status).toBe('failed')
      expect(group.group.status).toBe('failed')
    }
  })

  it('终态时未处理的审批不再停在 waiting', () => {
    const trace = buildExecutionTrace([
      event({ type: 'approval_required', tool: 'bash', toolCallId: 'c5', input: 'rm -rf x', textLength: 0 }),
      event({ type: 'failed', detail: '运行失败', status: 'failed' })
    ])
    const group = trace.segments[0]
    if (group.kind === 'group') expect(group.group.actions[0].status).toBe('failed')
  })

  it('正常完成但漏掉 tool_result 时收敛为 done', () => {
    const trace = buildExecutionTrace([readStarted(0), completed])
    const group = trace.segments[0]
    if (group.kind === 'group') {
      expect(group.group.actions[0].status).toBe('done')
      expect(group.group.status).toBe('done')
    }
  })

  it('终态后组内不残留任何 running/waiting 动作', () => {
    for (const terminal of ['completed', 'failed', 'cancelled', 'interrupted'] as const) {
      const trace = buildExecutionTrace([thinkingOn, readStarted(0), grepStarted(0), event({ type: terminal, status: terminal === 'completed' ? 'completed' : terminal })])
      expect(trace.pendingGroup).toBeNull()
      for (const segment of trace.segments) {
        if (segment.kind !== 'group') continue
        expect(segment.group.actions.some((action) => action.status === 'running' || action.status === 'waiting')).toBe(false)
        expect(segment.group.status).not.toBe('running')
      }
    }
  })
})

describe('traceGroupLabel', () => {
  const group = (actions: NonNullable<ReturnType<typeof buildExecutionTrace>['pendingGroup']>['actions']) => ({ actions, status: 'done' as const })

  it('thinking 与工具合并时 Thinked 固定居前', () => {
    const label = traceGroupLabel(group([
      { kind: 'thinking', status: 'done' },
      { kind: 'tool', tool: 'read', toolCallId: 'c1', input: null, status: 'done', durationMs: null },
      { kind: 'tool', tool: 'read', toolCallId: 'c2', input: null, status: 'done', durationMs: null }
    ]))
    expect(label).toBe('Thinked · Read ×2')
  })

  it('计数格式统一为 ×N，不分工具类别', () => {
    expect(traceGroupLabel(group([{ kind: 'tool', tool: 'bash', toolCallId: 'c1', input: null, status: 'done', durationMs: null }]))).toBe('Command ×1')
    expect(traceGroupLabel(group([
      { kind: 'tool', tool: 'grep', toolCallId: 'c1', input: null, status: 'done', durationMs: null },
      { kind: 'tool', tool: 'edit', toolCallId: 'c2', input: null, status: 'done', durationMs: null }
    ]))).toBe('Search ×1 · Edit ×1')
  })

  it('未收录工具保留原名并聚合计数', () => {
    expect(traceGroupLabel(group([
      { kind: 'tool', tool: 'skill_review', toolCallId: 'c1', input: null, status: 'done', durationMs: null },
      { kind: 'tool', tool: 'skill_review', toolCallId: 'c2', input: null, status: 'done', durationMs: null }
    ]))).toBe('skill_review ×2')
  })

  it('MCP 工具统一收敛为 Tool 并跨服务器合并计数', () => {
    expect(traceGroupLabel(group([
      { kind: 'tool', tool: 'mcp__AnySearch__batch_search', toolCallId: 'c1', input: null, status: 'done', durationMs: null },
      { kind: 'tool', tool: 'mcp__AnySearch__extract', toolCallId: 'c2', input: null, status: 'done', durationMs: null },
      { kind: 'tool', tool: 'mcp__Docs__query', toolCallId: 'c3', input: null, status: 'done', durationMs: null }
    ]))).toBe('Tool ×3')
  })
})

describe('traceGroupLiveLabel', () => {
  it('未完成动作显示实时动词', () => {
    expect(traceGroupLiveLabel({ actions: [{ kind: 'tool', tool: 'read', toolCallId: 'c1', input: null, status: 'running', durationMs: null }], status: 'running' })).toBe('Reading…')
    expect(traceGroupLiveLabel({ actions: [{ kind: 'tool', tool: 'bash', toolCallId: 'c1', input: null, status: 'running', durationMs: null }], status: 'running' })).toBe('Running command…')
    expect(traceGroupLiveLabel({ actions: [{ kind: 'thinking', status: 'running' }], status: 'running' })).toBe('Thinking')
    expect(traceGroupLiveLabel({ actions: [{ kind: 'tool', tool: 'mcp__AnySearch__extract', toolCallId: 'c1', input: null, status: 'running', durationMs: null }], status: 'running' })).toBe('Calling tool…')
  })

  it('已完成组返回 null 走静态摘要', () => {
    expect(traceGroupLiveLabel({ actions: [{ kind: 'tool', tool: 'read', toolCallId: 'c1', input: null, status: 'done', durationMs: null }], status: 'done' })).toBeNull()
  })
})

describe('formatElapsed', () => {
  it('中文分秒格式', () => {
    expect(formatElapsed(0)).toBe('0秒')
    expect(formatElapsed(45_000)).toBe('45秒')
    expect(formatElapsed(118_000)).toBe('1分58秒')
    expect(formatElapsed(136_000)).toBe('2分16秒')
  })
})
describe('Sub-agent 动态', () => {
  const sub = (patch: Partial<AgentEvent>): AgentEvent => event({
    subAgent: { taskId: 't1', agentId: 'scout', agentName: 'scout', status: 'running' },
    ...patch
  })
  const started = sub({ type: 'subagent_started', input: '调查调用链' })
  const pick = (events: AgentEvent[]) => {
    const trace = buildExecutionTrace(events)
    const action = trace.pendingGroup?.actions.find((item) => item.kind === 'subagent')
    if (action?.kind !== 'subagent') throw new Error('缺少 subagent 动作')
    return action
  }

  it('刚委派时没有动作，动态提示启动中', () => {
    const action = pick([started])
    expect(action.activity).toBeNull()
    expect(action.toolCount).toBe(0)
    expect(subAgentActivityLabel(action)).toBe('启动中…')
  })

  it('工具起始事件更新当前动作，完成事件累加计数', () => {
    const action = pick([
      started,
      sub({ type: 'subagent_update', tool: 'ls', status: 'running' }),
      sub({ type: 'subagent_update', tool: 'ls', status: 'completed' }),
      sub({ type: 'subagent_update', tool: 'grep', status: 'running' })
    ])
    expect(action.activity).toBe('Search')
    expect(action.toolCount).toBe(1)
    expect(subAgentActivityLabel(action)).toBe('Searching… · 已完成 1 个动作')
  })

  it('失败的工具同样计入已完成动作数', () => {
    const action = pick([started, sub({ type: 'subagent_update', tool: 'read', status: 'failed' })])
    expect(action.toolCount).toBe(1)
  })

  it('不带 tool 的更新（如 run_phase）不改动态', () => {
    const action = pick([
      started,
      sub({ type: 'subagent_update', tool: 'read', status: 'running' }),
      sub({ type: 'subagent_update', detail: '正在准备运行时' })
    ])
    expect(action.activity).toBe('Read')
  })

  it('终态清空当前动作，改为展示动作总数', () => {
    const trace = buildExecutionTrace([
      started,
      sub({ type: 'subagent_update', tool: 'ls', status: 'completed' }),
      sub({ type: 'subagent_update', tool: 'grep', status: 'completed' }),
      sub({ type: 'subagent_result', subAgent: { taskId: 't1', agentId: 'scout', agentName: 'scout', status: 'completed' } })
    ])
    const action = trace.pendingGroup?.actions.find((item) => item.kind === 'subagent')
    if (action?.kind !== 'subagent') throw new Error('缺少 subagent 动作')
    expect(action.status).toBe('done')
    expect(action.activity).toBeNull()
    expect(subAgentActivityLabel(action)).toBe('共 2 个动作')
  })

  it('没有调用过工具的子 Agent 终态不显示动态行', () => {
    const trace = buildExecutionTrace([started, sub({ type: 'subagent_cancelled', subAgent: { taskId: 't1', agentId: 'scout', agentName: 'scout', status: 'cancelled' } })])
    const action = trace.pendingGroup?.actions.find((item) => item.kind === 'subagent')
    if (action?.kind !== 'subagent') throw new Error('缺少 subagent 动作')
    expect(subAgentActivityLabel(action)).toBeNull()
  })
})

describe('委派工具本身不重复出现在摘要里', () => {
  const delegation = event({ type: 'tool_started', tool: 'subagent', toolCallId: 'c9', input: '{"tasks":[...]}' })
  const subStarted = (taskId: string) => event({ type: 'subagent_started', input: '调查 backend', subAgent: { taskId, agentId: 'scout', agentName: 'scout', status: 'running' } })

  it('摘要不含 subagent ×1，只保留 Sub-agent scout ×2', () => {
    const trace = buildExecutionTrace([event({ type: 'thinking_started' }), event({ type: 'thinking_ended' }), delegation, subStarted('t1'), subStarted('t2')])
    const label = traceGroupLabel(trace.pendingGroup!)
    expect(label).toBe('Thinked · Sub-agent scout ×2')
    expect(label).not.toContain('subagent ×')
  })

  it('不同 agent 分开计数', () => {
    const trace = buildExecutionTrace([
      delegation,
      subStarted('t1'),
      event({ type: 'subagent_started', subAgent: { taskId: 't2', agentId: 'reviewer', agentName: 'reviewer', status: 'running' } })
    ])
    expect(traceGroupLabel(trace.pendingGroup!)).toBe('Sub-agent scout ×1 · Sub-agent reviewer ×1')
  })

  it('实时状态行显示在跑的子 Agent，而不是委派工具', () => {
    const trace = buildExecutionTrace([delegation, subStarted('t1')])
    expect(traceGroupLiveLabel(trace.pendingGroup!)).toBe('Running scout…')
  })

  it('组内只有委派工具在跑时不再输出 subagent…', () => {
    const trace = buildExecutionTrace([delegation])
    expect(traceGroupLiveLabel(trace.pendingGroup!)).toBeNull()
  })

  it('isDelegationToolAction 只认委派工具', () => {
    expect(isDelegationToolAction({ kind: 'tool', tool: 'subagent', toolCallId: 'c9', input: null, status: 'running', durationMs: null })).toBe(true)
    expect(isDelegationToolAction({ kind: 'tool', tool: 'read', toolCallId: 'c1', input: null, status: 'running', durationMs: null })).toBe(false)
    expect(isDelegationToolAction({ kind: 'subagent', taskId: 't1', agentName: 'scout', task: null, status: 'running', activity: null, toolCount: 0 })).toBe(false)
  })
})

describe('thinkingTextByGroup', () => {
  const twoRounds = () => buildExecutionTrace([
    thinkingOn, thinkingOff, readStarted(0), readResult(5),
    thinkingOn, thinkingOff, grepStarted(5), grepResult(5),
    completed
  ])

  it('每个 Thinking 组按出现顺序领走自己那一段', () => {
    const trace = twoRounds()
    expect(trace.segments.map((segment) => segment.kind)).toEqual(['group', 'text', 'group'])
    const texts = thinkingTextByGroup(trace, ['先读文件', '再搜索'], '先读文件再搜索')
    expect(texts.get(0)).toBe('先读文件')
    expect(texts.get(2)).toBe('再搜索')
  })

  it('没有分段的旧回合退回全文只挂第一个组', () => {
    const texts = thinkingTextByGroup(twoRounds(), undefined, '整轮思考全文')
    expect(texts.get(0)).toBe('整轮思考全文')
    expect(texts.has(2)).toBe(false)
  })

  it('分段多于 Thinking 动作时把余下的并进最后一个组', () => {
    const texts = thinkingTextByGroup(twoRounds(), ['一', '二', '三'], '一二三')
    expect(texts.get(2)).toBe('二三')
  })

  it('组内有多轮思考时把这几段首尾相接，不插分隔符', () => {
    const trace = buildExecutionTrace([thinkingOn, thinkingOff, thinkingOn, thinkingOff, readStarted(0), readResult(0), completed])
    // 分段只是流式切片，插换行会把一段连续推理打成「每行几个字」。
    expect(thinkingTextByGroup(trace, ['前半段', '后半段'], '前半段后半段').get(0)).toBe('前半段后半段')
  })

  it('空段不占位，也不产生空展开', () => {
    const trace = buildExecutionTrace([thinkingOn, thinkingOff, readStarted(0), readResult(5), thinkingOn, thinkingOff, grepStarted(5), grepResult(5), completed])
    const texts = thinkingTextByGroup(trace, ['', '有内容'], '有内容')
    expect(texts.has(0)).toBe(false)
    expect(texts.get(2)).toBe('有内容')
  })

  it('没有 Thinking 组时不挂任何文本', () => {
    expect(thinkingTextByGroup(buildExecutionTrace([readStarted(0), readResult(0), completed]), ['一'], '一').size).toBe(0)
  })

  it('Thinking 还在进行中（只有 pendingGroup）时挂到 pendingGroup', () => {
    expect(thinkingTextByGroup(buildExecutionTrace([thinkingOn]), ['进行中'], '进行中').get('pending')).toBe('进行中')
  })
})
