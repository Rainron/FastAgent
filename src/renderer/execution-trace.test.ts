import { describe, expect, it } from 'vitest'
import { buildExecutionTrace, formatElapsed, hasToolAction, isDelegationToolAction, liveTarget, subAgentActivityLabel, thinkingTextByGroup, traceAnswerStart, traceFinalAnswerLength, traceGroupDiff, traceGroupLabel, traceGroupLiveLabel, traceRunStatusText, traceOutcomeLabel, traceSummary, traceSummaryLabel, traceTextBoundary, traceTokenTotal } from './execution-trace'
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

describe('正文切片起点', () => {
  it('执行中只取未归档的尾部，终态取整条最终回答', () => {
    expect(traceAnswerStart('working', 12)).toBe(12)
    expect(traceAnswerStart('done', 12)).toBe(0)
    expect(traceAnswerStart('interrupted', 12)).toBe(0)
  })
})

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

describe('traceGroupLabel 文案风格', () => {
  const group = (actions: NonNullable<ReturnType<typeof buildExecutionTrace>['pendingGroup']>['actions']) => ({ actions, status: 'done' as const })
  const tool = (name: string, id: string, input: string | null = null) => ({ kind: 'tool' as const, tool: name, toolCallId: id, input, status: 'done' as const, durationMs: null })

  it('中文风格折成自然语句', () => {
    expect(traceGroupLabel(group([tool('read', 'c1'), tool('read', 'c2'), tool('bash', 'c3')]), 'zh')).toBe('读取 2 个文件，运行 1 条命令')
  })

  it('英文风格折成自然语句且首字母大写', () => {
    expect(traceGroupLabel(group([tool('bash', 'c1'), tool('bash', 'c2')]), 'en')).toBe('Ran 2 commands')
    expect(traceGroupLabel(group([tool('bash', 'c1')]), 'en')).toBe('Ran a command')
  })

  it('只调用一次且入参是路径时直接说文件名', () => {
    expect(traceGroupLabel(group([tool('read', 'c1', 'src/main/index.ts')]), 'zh')).toBe('读取 index.ts')
    expect(traceGroupLabel(group([tool('write', 'c1', 'docs/plan.md')]), 'en')).toBe('Created plan.md')
  })

  it('同一动词命中多个文件时改说个数，不挑其中一个冒充全部', () => {
    expect(traceGroupLabel(group([tool('read', 'c1', 'a.ts'), tool('read', 'c2', 'b.ts')]), 'zh')).toBe('读取 2 个文件')
  })

  it('命令与搜索不把入参当文件名', () => {
    expect(traceGroupLabel(group([tool('bash', 'c1', 'npm run build')]), 'zh')).toBe('运行 1 条命令')
    expect(traceGroupLabel(group([tool('grep', 'c1', 'TODO')]), 'zh')).toBe('搜索 1 次')
  })

  it('思考在中英文下都有对应说法', () => {
    expect(traceGroupLabel(group([{ kind: 'thinking', status: 'done' }, tool('read', 'c1')]), 'zh')).toBe('思考，读取 1 个文件')
    expect(traceGroupLabel(group([{ kind: 'thinking', status: 'done' }]), 'en')).toBe('Thought')
  })

  it('compact 仍是既有形态，缺省参数不改变旧行为', () => {
    const actions = [tool('read', 'c1'), tool('read', 'c2')]
    expect(traceGroupLabel(group(actions), 'compact')).toBe('Read ×2')
    expect(traceGroupLabel(group(actions))).toBe('Read ×2')
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

  it('带上动作对象：路径只留文件名，命令取首行', () => {
    expect(traceGroupLiveLabel({ actions: [{ kind: 'tool', tool: 'read', toolCallId: 'c1', input: 'src/renderer/App.tsx', status: 'running', durationMs: null }], status: 'running' }, 'zh')).toBe('正在读取 App.tsx')
    expect(traceGroupLiveLabel({ actions: [{ kind: 'tool', tool: 'bash', toolCallId: 'c1', input: 'npm test', status: 'running', durationMs: null }], status: 'running' }, 'zh')).toBe('正在运行命令 npm test')
    expect(traceGroupLiveLabel({ actions: [{ kind: 'tool', tool: 'edit', toolCallId: 'c1', input: 'a/b.ts', status: 'running', durationMs: null }], status: 'running' }, 'en')).toBe('Editing b.ts')
  })

  it('并行的子代理全部点名', () => {
    const sub = (taskId: string, agentName: string) => ({ kind: 'subagent' as const, taskId, agentName, task: null, status: 'running' as const, activity: null, toolCount: 0 })
    expect(traceGroupLiveLabel({ actions: [sub('t1', 'scout'), sub('t2', 'reviewer')], status: 'running' }, 'zh')).toBe('正在运行 scout、reviewer…')
  })
})

describe('liveTarget', () => {
  it('路径类动作只留文件名', () => {
    expect(liveTarget('Read', 'K:/proj/src/a.ts')).toBe('a.ts')
  })

  it('命令截断到一行内', () => {
    const target = liveTarget('Command', `echo ${'x'.repeat(100)}\nsecond line`) ?? ''
    expect(target.endsWith('…')).toBe(true)
    expect(target).not.toContain('second')
  })

  it('搜索的 JSON 入参取关键字', () => {
    expect(liveTarget('Search', '{"pattern":"TODO","path":"src"}')).toBe('TODO')
    expect(liveTarget('Search', '{"path":"src"}')).toBeNull()
  })

  it('MCP 等无法解读的入参不给对象', () => {
    expect(liveTarget('Tool', '{"url":"x"}')).toBeNull()
    expect(liveTarget('Read', null)).toBeNull()
  })
})

describe('formatElapsed', () => {
  it('中文分秒格式', () => {
    expect(formatElapsed(0)).toBe('0秒')
    expect(formatElapsed(45_000)).toBe('45秒')
    expect(formatElapsed(118_000)).toBe('1分58秒')
    expect(formatElapsed(136_000)).toBe('2分16秒')
  })

  it('英文风格用 m / s', () => {
    expect(formatElapsed(45_000, 'en')).toBe('45s')
    expect(formatElapsed(326_000, 'en')).toBe('5m 26s')
  })
})

describe('traceRunStatusText', () => {
  it('执行中优先显示当前动作，没有动作时给通用文案', () => {
    expect(traceRunStatusText('working', '正在读取…', 'zh')).toBe('正在读取…')
    expect(traceRunStatusText('working', null, 'zh')).toBe('正在执行…')
    expect(traceRunStatusText('working', null, 'en')).toBe('Running…')
  })

  it('终态按结果给词，不再显示动作', () => {
    expect(traceRunStatusText('cancelled', '正在读取…', 'zh')).toBe('已取消')
    expect(traceRunStatusText('failed', null, 'en')).toBe('Failed')
  })
})

describe('traceSummary 过程头摘要', () => {
  it('跨动作组累计调用数、子代理数与增删行数', () => {
    const trace = buildExecutionTrace([
      readStarted(0),
      readResult(0),
      grepStarted(30),
      grepResult(30),
      event({ type: 'tool_started', tool: 'edit', toolCallId: 'c3', input: 'src/a.ts' }),
      event({ type: 'file_changed', path: 'src/a.ts', additions: 9, deletions: 2 }),
      event({ type: 'tool_result', tool: 'edit', toolCallId: 'c3', status: 'completed' }),
      completed
    ])
    expect(traceSummary(trace)).toEqual({ calls: 3, subagents: 0, diff: { additions: 9, deletions: 2 } })
    expect(traceSummaryLabel(traceSummary(trace), 'zh')).toBe('执行过程 · 3 次调用')
  })

  it('委派工具本身不计入调用数，只算它下面的子代理', () => {
    const trace = buildExecutionTrace([
      event({ type: 'tool_started', tool: 'subagent', toolCallId: 'c1', input: '调查调用链' }),
      event({ type: 'subagent_started', subAgent: { taskId: 't1', agentId: 'scout', agentName: 'scout', status: 'running' } }),
      event({ type: 'subagent_result', subAgent: { taskId: 't1', agentId: 'scout', agentName: 'scout', status: 'completed' } }),
      completed
    ])
    expect(traceSummary(trace)).toMatchObject({ calls: 0, subagents: 1 })
    expect(traceSummaryLabel(traceSummary(trace), 'zh')).toBe('执行过程 · 1 个子代理')
  })

  it('没有任何调用时只留标题，不写 0 次调用', () => {
    const trace = buildExecutionTrace([thinkingOn, thinkingOff, completed])
    expect(traceSummary(trace)).toEqual({ calls: 0, subagents: 0, diff: null })
    expect(traceSummaryLabel(traceSummary(trace), 'zh')).toBe('执行过程')
    expect(traceSummaryLabel(traceSummary(trace), 'en')).toBe('Execution')
  })
})

describe('traceGroupDiff 与 file_changed 归并', () => {
  it('按入参里的文件名把增删行数挂回对应工具动作', () => {
    const trace = buildExecutionTrace([
      event({ type: 'tool_started', tool: 'edit', toolCallId: 'c1', input: 'src/a.ts' }),
      event({ type: 'tool_started', tool: 'edit', toolCallId: 'c2', input: 'src/b.ts' }),
      event({ type: 'file_changed', path: 'src/b.ts', additions: 10, deletions: 4 }),
      event({ type: 'file_changed', path: 'src/a.ts', additions: 1, deletions: 0 })
    ])
    const actions = trace.pendingGroup!.actions
    expect(actions[0]).toMatchObject({ toolCallId: 'c1', diff: { additions: 1, deletions: 0 } })
    expect(actions[1]).toMatchObject({ toolCallId: 'c2', diff: { additions: 10, deletions: 4 } })
    expect(traceGroupDiff(trace.pendingGroup!)).toEqual({ additions: 11, deletions: 4 })
  })

  it('对不上文件名时落到组内最后一个工具动作，不丢统计', () => {
    const trace = buildExecutionTrace([
      event({ type: 'tool_started', tool: 'bash', toolCallId: 'c1', input: 'npm run codegen' }),
      event({ type: 'file_changed', path: 'src/generated.ts', additions: 120, deletions: 0 })
    ])
    expect(traceGroupDiff(trace.pendingGroup!)).toEqual({ additions: 120, deletions: 0 })
  })

  it('没有任何改动统计时返回 null，界面据此不画这段', () => {
    const trace = buildExecutionTrace([event({ type: 'tool_started', tool: 'read', toolCallId: 'c1', input: 'src/a.ts' })])
    expect(traceGroupDiff(trace.pendingGroup!)).toBeNull()
  })
})

describe('traceTokenTotal', () => {
  const usage = (input: number, output: number) => ({ latest: null, turn: { requestCount: 1, reportedReadRequests: 0, reportedWriteRequests: 0, inputTokens: input, outputTokens: output, readInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, session: { requestCount: 1, reportedReadRequests: 0, reportedWriteRequests: 0, inputTokens: input, outputTokens: output, readInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })

  it('取最后一条回合聚合', () => {
    expect(traceTokenTotal([
      event({ type: 'usageUpdated', usage: usage(100, 20) }),
      event({ type: 'usageUpdated', usage: usage(4000, 243) })
    ])).toBe(4243)
  })

  it('没有聚合数据时返回 null，而不是假的 0', () => {
    expect(traceTokenTotal([event({ type: 'tool_started', tool: 'read', toolCallId: 'c1' })])).toBeNull()
  })

  it('合计为 0（请求没回来就取消）时返回 null，不显示 0 tokens', () => {
    expect(traceTokenTotal([event({ type: 'usageUpdated', usage: usage(0, 0) })])).toBeNull()
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
    expect(subAgentActivityLabel(action)).toBe('正在搜索… · 已完成 1 个动作')
  })

  it('进度事件带入参时显示动作对象，且不会被当成任务描述', () => {
    const action = pick([
      started,
      sub({ type: 'subagent_update', tool: 'read', status: 'running', input: 'src/main/index.ts' })
    ])
    expect(action.task).toBe('调查调用链')
    expect(subAgentActivityLabel(action)).toBe('正在读取 index.ts')
  })

  it('记录起止时间，终态后清空动作对象', () => {
    const trace = buildExecutionTrace([
      sub({ type: 'subagent_started', input: '调查', timestamp: 1000 }),
      sub({ type: 'subagent_update', tool: 'read', status: 'running', input: 'a.ts', timestamp: 2000 }),
      sub({ type: 'subagent_result', timestamp: 5000, subAgent: { taskId: 't1', agentId: 'scout', agentName: 'scout', status: 'completed' } })
    ])
    const action = trace.pendingGroup?.actions.find((item) => item.kind === 'subagent')
    if (action?.kind !== 'subagent') throw new Error('缺少 subagent 动作')
    expect(action.startedAt).toBe(1000)
    expect(action.finishedAt).toBe(5000)
    expect(action.activityTarget).toBeNull()
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
    expect(traceGroupLiveLabel(trace.pendingGroup!, 'zh')).toBe('正在运行 scout…')
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

describe('hasToolAction', () => {
  it('只有思考时为 false：纯问答回合仍走轻量分析卡', () => {
    expect(hasToolAction(buildExecutionTrace([thinkingOn, thinkingOff, completed]))).toBe(false)
  })

  it('出现工具动作后为 true', () => {
    expect(hasToolAction(buildExecutionTrace([readStarted(0), readResult(0), completed]))).toBe(true)
  })

  it('工具还在进行（pendingGroup）时也为 true', () => {
    expect(hasToolAction(buildExecutionTrace([readStarted(0)]))).toBe(true)
  })
})

describe('正文边界', () => {
  it('记账事件带完整正文长度时，文本段仍止步于最终回答起点', () => {
    // usageUpdated 在消息结束时带上整段 transcript 长度，直接切分会把最终回答也归档进轨迹，
    // 正文区再渲染一次同一段文字就成了两遍。
    const trace = buildExecutionTrace([
      readStarted(0),
      readResult(12),
      event({ type: 'usageUpdated', textLength: 42 }),
      event({ type: 'completed', text: '最终回答', status: 'completed', textLength: 42 })
    ], 30)
    expect(trace.segments).toEqual([
      { kind: 'group', group: expect.objectContaining({ status: 'done' }) },
      { kind: 'text', start: 0, end: 12 }
    ])
    expect(trace.answerStart).toBe(12)
  })

  it('只保留夹取后的说明文本，正文起点跟着走到边界', () => {
    const trace = buildExecutionTrace([
      readStarted(0),
      readResult(20),
      event({ type: 'completed', text: '最终回答', status: 'completed', textLength: 50 })
    ], 40)
    expect(trace.segments).toEqual([
      { kind: 'group', group: expect.objectContaining({ status: 'done' }) },
      { kind: 'text', start: 0, end: 10 }
    ])
    expect(trace.answerStart).toBe(10)
  })

  it('夹取只砍掉越过边界的部分，边界之前的说明文本保留', () => {
    const trace = buildExecutionTrace([
      readStarted(0),
      readResult(40),
      event({ type: 'usageUpdated', textLength: 50 }),
      event({ type: 'completed', text: '最终回答', status: 'completed', textLength: 50 })
    ], 10)
    expect(trace.segments).toEqual([
      { kind: 'group', group: expect.objectContaining({ status: 'done' }) },
      { kind: 'text', start: 0, end: 40 }
    ])
    expect(trace.answerStart).toBe(40)
  })

  it('夹取只在终态生效，执行中传 0 不夹取', () => {
    expect(traceFinalAnswerLength('working', 120)).toBe(0)
    expect(traceFinalAnswerLength('done', 120)).toBe(120)
    // 取消/失败没有最终回答时长度为 0，同样不夹取
    expect(traceFinalAnswerLength('cancelled', 0)).toBe(0)
  })

  it('拿不到最终回答长度或终态长度时不夹取', () => {
    expect(traceTextBoundary([completed], 30)).toBe(60)
    expect(traceTextBoundary([completed], 0)).toBe(Number.POSITIVE_INFINITY)
    expect(traceTextBoundary([readStarted(0)], 30)).toBe(Number.POSITIVE_INFINITY)
    expect(traceTextBoundary([event({ type: 'completed', status: 'completed' })], 30)).toBe(Number.POSITIVE_INFINITY)
    // 回答比 transcript 还长（旧回合只有 assistantMessage）时收到 0，不出现负边界
    expect(traceTextBoundary([event({ type: 'completed', textLength: 10 })], 30)).toBe(0)
  })

  it('整轮回放：轨迹文本段与正文区合起来正好是整段正文，既不重叠也不丢字', () => {
    const narration1 = '先确认工作区。\n'
    const narration2 = '再看一眼配置。\n'
    const answer = '结论如下：最终回答。'
    const transcript = `${narration1}${narration2}${answer}`
    const trace = buildExecutionTrace([
      thinkingOn, thinkingOff,
      readStarted(0), readResult(narration1.length),
      // 每条助手消息结束时上报 usage，带上当时的完整正文长度
      event({ type: 'usageUpdated', textLength: narration1.length }),
      grepStarted(narration1.length), grepResult(narration1.length + narration2.length),
      event({ type: 'usageUpdated', textLength: narration1.length + narration2.length }),
      // 最终回答写完后、终态事件之前还会来一条 usage，它带的长度已经是整段 transcript
      event({ type: 'usageUpdated', textLength: transcript.length }),
      event({ type: 'completed', text: answer, status: 'completed', textLength: transcript.length })
    ], answer.length)
    const rendered = trace.segments.filter((segment) => segment.kind === 'text').map((segment) => transcript.slice(segment.start, segment.end))
    expect(rendered).toEqual([narration1, narration2])
    // 正文区渲染的是 transcript 尾部那一段；两段拼起来就是完整正文，没有重复也没有空档
    expect(rendered.join('') + transcript.slice(transcript.length - answer.length)).toBe(transcript)
    expect(trace.answerStart).toBe(transcript.length - answer.length)
  })
})

describe('插队消息', () => {
  it('按发生顺序成为动作组的同级节点，不嵌套进组', () => {
    const trace = buildExecutionTrace([
      readStarted(0),
      event({ type: 'user_steer', text: '先看配置文件' }),
      readResult(0),
      completed
    ])
    const [first, inserted] = trace.segments
    expect(first.kind).toBe('group')
    expect(inserted).toMatchObject({ kind: 'steer', text: '先看配置文件' })
    if (first.kind !== 'group') return
    expect(first.group.actions.map((action) => action.kind)).toEqual(['tool'])
    expect(traceGroupLabel(first.group)).toBe('Read ×1')
  })

  it('只有补充没有工具时不算有工具动作', () => {
    const trace = buildExecutionTrace([event({ type: 'user_steer', text: '补充一句' }), completed])
    expect(hasToolAction(trace)).toBe(false)
  })

  it('没有正文也没有附件的补充事件不产生动作', () => {
    const trace = buildExecutionTrace([event({ type: 'user_steer' }), completed])
    expect(hasToolAction(trace)).toBe(false)
    expect(trace.segments).toHaveLength(0)
  })

  it('补充带的附件挂在同一个节点上', () => {
    const attachment = { id: 'a1', name: '截图.png', type: 'image/png', size: 2048, localPath: 'C:/att/a1.png' }
    const trace = buildExecutionTrace([event({ type: 'user_steer', text: '照着这张图改', attachments: [attachment] }), completed])
    expect(trace.segments).toEqual([{ kind: 'steer', text: '照着这张图改', attachments: [attachment] }])
  })

  it('只带附件不带正文的补充照样出节点', () => {
    const attachment = { id: 'a2', name: '日志.txt', type: 'text/plain', size: 120 }
    const trace = buildExecutionTrace([event({ type: 'user_steer', attachments: [attachment] }), completed])
    expect(trace.segments).toEqual([{ kind: 'steer', text: '', attachments: [attachment] }])
  })

  it('旧记录没有附件字段时补空数组', () => {
    const trace = buildExecutionTrace([event({ type: 'user_steer', text: '补充一句' }), completed])
    expect(trace.segments).toEqual([{ kind: 'steer', text: '补充一句', attachments: [] }])
  })
})

describe('traceOutcomeLabel', () => {
  it('终态过程头只说一次结果，并带上本轮做了多少事', () => {
    const trace = buildExecutionTrace([readStarted(0), readResult(0), grepStarted(0), grepResult(0), completed])
    expect(traceOutcomeLabel('done', traceSummary(trace), 'zh')).toBe('已完成 · 2 次调用')
    expect(traceOutcomeLabel('cancelled', traceSummary(buildExecutionTrace([])), 'zh')).toBe('已取消')
    expect(traceOutcomeLabel('failed', traceSummary(trace), 'en')).toBe('Failed · 2 calls')
  })
})
