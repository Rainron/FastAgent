import type { AgentEvent, Attachment, TraceLabelStyle } from '../shared/types'

/**
 * 内联执行轨迹的纯逻辑：把 turn 的事件流折成「动作组 + 文本段」交替序列。
 * 分段点 = Agent 可见正文输出：非 token 事件携带 textLength（截至该事件已输出的正文长度），
 * 一旦 textLength 超过已归档正文游标，说明模型在两段动作之间输出了说明文本，当前动作组收尾。
 * token 事件不落库，因此切分只依赖后续动作事件的 textLength，历史回放同样成立。
 * 文本段止步于最终回答起点：正文区渲染的是 transcript 尾部的最后一条助手消息，见 traceTextBoundary。
 */

export type TraceToolStatus = 'waiting' | 'running' | 'done' | 'failed'

/** 单次工具调用改动的行数；来自 file_changed 事件，write / shell 无旧内容可比时缺省。 */
export interface TraceDiffStat {
  additions: number
  deletions: number
}

export type TraceAction =
  | { kind: 'tool'; tool: string; toolCallId: string | null; input: string | null; status: TraceToolStatus; durationMs: number | null; diff?: TraceDiffStat }
  | { kind: 'thinking'; status: 'running' | 'done' }
  | {
    kind: 'subagent'
    taskId: string
    agentName: string
    task: string | null
    status: TraceToolStatus
    /** 子 Agent 当前动作（已归一成 Action 名）；没有在跑的动作时为 null。 */
    activity: string | null
    /** 当前动作的对象（文件名 / 命令 / 关键字）；旧事件不带入参时为 null。 */
    activityTarget?: string | null
    /** 首个子代理事件与终态事件的时间戳；旧事件没有 timestamp 时为 null。 */
    startedAt?: number | null
    finishedAt?: number | null
    /** 失败原因（subagent_failed 的 detail）。 */
    error?: string | null
    /** 子 Agent 已完成的工具调用数，终态后作为总量展示。 */
    toolCount: number
    parentRunId?: string
    subAgentRunId?: string
    handoff?: NonNullable<AgentEvent['subAgent']>['handoff']
  }

export type TraceGroupStatus = 'running' | 'done' | 'failed'

export interface TraceGroup {
  actions: TraceAction[]
  status: TraceGroupStatus
}

export type TraceSegment =
  | { kind: 'group'; group: TraceGroup }
  /** 用户补充是时间线节点，不属于模型动作组；附件与正文同源，旧记录没有这个字段。 */
  | { kind: 'steer'; text: string; attachments: Attachment[] }
  /** 正文切片 [start, end)，紧随前一动作组之后展示。 */
  | { kind: 'text'; start: number; end: number }

/**
 * 正文切片起点：工作中的正文区只拿未归档的尾部（前段说明文本已经在轨迹里），
 * 终态正文区渲染整条最终回答（最后一条助手消息）。
 * 挂载位置与展开状态无关：正文永远排在详情区之后、收尾行之前，展开只影响它上方有没有动作组。
 */
export function traceAnswerStart(kind: 'working' | 'done' | 'failed' | 'cancelled' | 'interrupted', answerStart: number): number {
  return kind === 'working' ? answerStart : 0
}

export interface ExecutionTrace {
  /** 已归档的轨迹：动作组与说明文本段按真实顺序交替（不含进行中组）。 */
  segments: TraceSegment[]
  /** 尚未收尾的动作组（执行中）；终态后为 null。 */
  pendingGroup: TraceGroup | null
  /** 正文区起点：最终回答 = 完整正文从该偏移开始，之前的内容已落入各文本段。 */
  answerStart: number
  /** 至少有一个动作（思考或工具）可展示。 */
  hasActivity: boolean
}

const TOOL_EVENT_TYPES = new Set(['tool_started', 'tool_result', 'approval_required', 'question_required', 'subagent_started', 'subagent_update', 'subagent_result', 'subagent_failed', 'subagent_cancelled'])
const TERMINAL_EVENT_TYPES = new Set(['completed', 'failed', 'cancelled', 'interrupted'])

/**
 * 轨迹文本段的右边界（transcript 坐标）：终态正文区渲染的是 transcript 的尾部——最后一条助手消息，
 * 越过这条线的文字已经在正文区出现过，再切进轨迹就是同一段正文渲染两次。
 * 记账事件（usageUpdated、run_phase 等）在正文写完后才带上完整长度，会把最终回答一起推进文本段，
 * 这里用「终态事件长度 - 最终回答长度」把边界收在回答起点上。两个长度来自不同通道（流式全文 vs 最后一条
 * 助手消息）时可能差几个字符，宁可少夹一点（说明文本还留在轨迹里）也不把正文切成两半。
 * 拿不到这两个数字（执行中无终态事件、旧回合没落 transcript、回答为空）时不夹取，轨迹按原样切分。
 */
export function traceTextBoundary(events: AgentEvent[], finalAnswerLength: number): number {
  if (finalAnswerLength <= 0) return Number.POSITIVE_INFINITY
  const terminal = events.find((event) => TERMINAL_EVENT_TYPES.has(event.type) && event.textLength !== undefined)
  if (!terminal || terminal.textLength === undefined) return Number.POSITIVE_INFINITY
  return Math.max(0, terminal.textLength - finalAnswerLength)
}

/**
 * 夹取长度的取值口径：只有终态才夹——终态正文区渲染最后一条助手消息，也要夹。
 * 执行中正文区按未归档尾部切片、当前还不渲染，必须传 0：否则说明文本会被提前夹掉，
 * 而且流式期间长度每帧都在变，会把轨迹的重算拖成 60fps。
 * 调用方取值必须与轨迹的 kind 同源（都用 activity.status）：一边夹取一边不渲染正文，回答就彻底不见了。
 */
export function traceFinalAnswerLength(kind: 'working' | 'done' | 'failed' | 'cancelled' | 'interrupted', answerTextLength: number): number {
  return kind === 'working' ? 0 : answerTextLength
}

/** 无 toolCallId 的旧事件按工具名聚合到同一动作，避免碎片化。 */
function toolKey(event: AgentEvent): string | null {
  if (!TOOL_EVENT_TYPES.has(event.type)) return null
  return event.subAgent ? `subagent:${event.subAgent.taskId}` : event.toolCallId ?? `tool:${event.tool ?? 'tool'}`
}

/**
 * 子 Agent 的动态：subagent_update 携带子运行的工具起止（tool + status），
 * 折成「当前动作 + 已完成动作数」。子 Agent 的流式正文不回传（会压垮主进程），
 * 工具级动态是卡片能拿到的唯一进度信号。
 */
function applySubAgentProgress(action: Extract<TraceAction, { kind: 'subagent' }>, event: AgentEvent) {
  // 终态不再有动作在跑，留着当前动作会变成永久的假进行中。
  if (action.status !== 'running' && action.status !== 'waiting') {
    action.activity = null
    action.activityTarget = null
    if (action.finishedAt == null && event.timestamp !== undefined) action.finishedAt = event.timestamp
    return
  }
  if (event.type !== 'subagent_update' || !event.tool) return
  action.activity = verbFor(event.tool)
  // 只有工具开始事件带入参；结果事件不带，沿用开始时的对象，免得动作还没换对象先被清空。
  if (event.input) action.activityTarget = liveTarget(action.activity, event.input)
  if (event.status === 'completed' || event.status === 'failed') action.toolCount += 1
}

/** 路径取文件名：轨迹一行放不下完整路径，摘要里只认得出是哪个文件就够。 */
export function traceFileName(path: string | null | undefined): string | null {
  if (!path) return null
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  return name || null
}

/**
 * 把 file_changed 的增删行数挂回产生它的工具动作。
 * 事件只带路径不带 toolCallId，按入参里的文件名回指；对不上时落到组内最后一个工具动作
 * （同一组里能改文件的就是它），宁可挂错一格也不把改动行数丢掉。
 */
function applyFileChange(actions: TraceAction[], event: AgentEvent) {
  const additions = event.additions ?? 0
  const deletions = event.deletions ?? 0
  if (!additions && !deletions) return
  const tools = actions.filter((action): action is Extract<TraceAction, { kind: 'tool' }> => action.kind === 'tool')
  if (!tools.length) return
  const name = traceFileName(event.path)
  const target = (name ? [...tools].reverse().find((action) => action.input && action.input.includes(name)) : null) ?? tools[tools.length - 1]
  const current = target.diff ?? { additions: 0, deletions: 0 }
  target.diff = { additions: current.additions + additions, deletions: current.deletions + deletions }
}

/** 动作组的增删合计；组里没有任何带统计的动作时返回 null，界面据此不画这段。 */
export function traceGroupDiff(group: TraceGroup): TraceDiffStat | null {
  let additions = 0
  let deletions = 0
  let found = false
  for (const action of group.actions) {
    if (action.kind !== 'tool' || !action.diff) continue
    found = true
    additions += action.diff.additions
    deletions += action.diff.deletions
  }
  return found ? { additions, deletions } : null
}

/** 过程头那一行的摘要口径。 */
export interface TraceSummary {
  /** 工具调用次数；委派工具不计——它本身就是下面那个子代理。 */
  calls: number
  subagents: number
  diff: TraceDiffStat | null
}

/** 整条轨迹的摘要：过程头收起时，用户只能靠这行判断里面有没有值得展开的东西。 */
export function traceSummary(trace: ExecutionTrace): TraceSummary {
  const groups = trace.segments
    .filter((segment): segment is { kind: 'group'; group: TraceGroup } => segment.kind === 'group')
    .map((segment) => segment.group)
  if (trace.pendingGroup) groups.push(trace.pendingGroup)
  let calls = 0
  let subagents = 0
  let additions = 0
  let deletions = 0
  let hasDiff = false
  for (const group of groups) {
    for (const action of group.actions) {
      if (action.kind === 'subagent') { subagents += 1; continue }
      if (action.kind !== 'tool' || isDelegationToolAction(action)) continue
      calls += 1
      if (!action.diff) continue
      hasDiff = true
      additions += action.diff.additions
      deletions += action.diff.deletions
    }
  }
  return { calls, subagents, diff: hasDiff ? { additions, deletions } : null }
}

function summaryParts(summary: TraceSummary, style: TraceLabelStyle): string[] {
  const zh = style === 'zh'
  const parts: string[] = []
  if (summary.calls > 0) parts.push(zh ? `${summary.calls} 次调用` : `${summary.calls} calls`)
  if (summary.subagents > 0) parts.push(zh ? `${summary.subagents} 个子代理` : `${summary.subagents} sub-agents`)
  return parts
}

/** 摘要文案；没有任何调用时只留标题，不写「0 次调用」这种废话。 */
export function traceSummaryLabel(summary: TraceSummary, style: TraceLabelStyle): string {
  const head = style === 'zh' ? '执行过程' : 'Execution'
  const parts = summaryParts(summary, style)
  return parts.length ? `${head} · ${parts.join(' · ')}` : head
}

/**
 * 终态过程头：结果 + 这一轮做了多少事（`已完成 · 3 次调用`）。
 * 结果只在这一处说：收尾行和正文区再各说一遍「已取消」，同一件事就出现了三次。
 */
export function traceOutcomeLabel(kind: 'done' | 'failed' | 'cancelled' | 'interrupted', summary: TraceSummary, style: TraceLabelStyle): string {
  const outcome = traceRunStatusText(kind, null, style)
  const parts = summaryParts(summary, style)
  return parts.length ? `${outcome} · ${parts.join(' · ')}` : outcome
}

function groupStatus(actions: TraceAction[]): TraceGroupStatus {
  return actions.some((action) => action.status === 'failed') ? 'failed'
    : actions.some((action) => action.status === 'running' || action.status === 'waiting') ? 'running'
      : 'done'
}

/** 工具调用意味着模型已经离开思考阶段：此时仍挂着的 Thinking 必须收敛，否则整组跟着卡在转圈。 */
function settleThinking(actions: TraceAction[]) {
  for (const action of actions) {
    if (action.kind === 'thinking' && action.status === 'running') action.status = 'done'
  }
}

/**
 * 归档动作组前强制结算：组一旦被固化（下一阶段开始、正文输出、运行终态），
 * 就不再有事件来更新它，留着 running/waiting 只会变成永久的假 Loading。
 * unfinished 决定没拿到结果的工具落到哪个终态：正常收尾算完成，中途终止算失败。
 */
function settleActions(actions: TraceAction[], unfinished: 'done' | 'failed') {
  settleThinking(actions)
  for (const action of actions) {
    if (action.kind === 'tool' && (action.status === 'running' || action.status === 'waiting')) action.status = unfinished
  }
}

export function buildExecutionTrace(events: AgentEvent[], finalAnswerLength = 0): ExecutionTrace {
  const segments: TraceSegment[] = []
  let actions: TraceAction[] = []
  let segmentedGroup: TraceGroup | null = null
  // 正文区渲染 transcript 尾部那一段（最后一条助手消息），轨迹文本段不得越过它，否则同一段正文渲染两次。
  const textLimit = traceTextBoundary(events, finalAnswerLength)
  // 已归档正文的游标；<= 它的部分要么进了文本段，要么在正文区。
  let cursor = 0
  let thinkingActive = false

  const flush = (unfinished: 'done' | 'failed' = 'done') => {
    if (!actions.length) return
    settleActions(actions, unfinished)
    if (segmentedGroup) segmentedGroup.status = groupStatus(actions)
    else segments.push({ kind: 'group', group: { actions, status: groupStatus(actions) } })
    actions = []
    segmentedGroup = null
  }

  // 文本分段点：正文在该事件之前又长出来了，固化上一组并归档说明文本。
  const checkTextBoundary = (event: AgentEvent) => {
    if (event.textLength === undefined) return
    const end = Math.min(event.textLength, textLimit)
    if (end <= cursor) return
    flush()
    segments.push({ kind: 'text', start: cursor, end })
    cursor = end
  }

  for (const event of events) {
    // 终态不再切分文本：最后一个未封闭文本段留在正文区作为最终回答。
    // 终态之后落库的 cleanup / contextUpdated 携带完整正文长度，继续消费会把最终回答
    // 切进轨迹文本段，终态默认折叠时正文区就空了，因此在终态处停止。
    if (TERMINAL_EVENT_TYPES.has(event.type)) {
      thinkingActive = false
      // 取消/失败/中断时在飞的工具永远收不到 tool_result，按未完成结算；正常收尾则视为已完成。
      flush(event.type === 'completed' ? 'done' : 'failed')
      break
    }
    if (event.subAgent) {
      const key = toolKey(event)
      const existing = actions.find((action): action is Extract<TraceAction, { kind: 'subagent' }> => action.kind === 'subagent' && `subagent:${action.taskId}` === key)
      const status: TraceToolStatus = event.type === 'subagent_failed' ? 'failed' : event.type === 'subagent_result' || event.type === 'subagent_cancelled' ? 'done' : 'running'
      if (existing) {
        existing.status = status
        existing.handoff = event.subAgent.handoff ?? existing.handoff
        // started 事件还没有子运行 id，要等第一条转发事件补上。
        existing.subAgentRunId = existing.subAgentRunId ?? event.subAgent.subAgentRunId
        if (!existing.task && event.type === 'subagent_started') existing.task = event.input ?? null
        if (event.type === 'subagent_failed') existing.error = event.detail ?? existing.error ?? null
        applySubAgentProgress(existing, event)
      } else {
        // 转发的子代理进度事件也带 input（子 Agent 的工具入参），只有 started 的 input 才是任务描述。
        const task = event.type === 'subagent_update' ? null : event.input ?? null
        const action: Extract<TraceAction, { kind: 'subagent' }> = { kind: 'subagent', taskId: event.subAgent.taskId, agentName: event.subAgent.agentName, task, status, activity: null, toolCount: 0, parentRunId: event.subAgent.parentRunId, subAgentRunId: event.subAgent.subAgentRunId, handoff: event.subAgent.handoff, startedAt: event.timestamp ?? null, finishedAt: null }
        applySubAgentProgress(action, event)
        actions.push(action)
      }
      checkTextBoundary(event)
      continue
    }
    if (event.type === 'tool_result') {
      settleThinking(actions)
      // 先结算工具状态再切分：result 的 textLength 已包含该工具完成后的正文，
      // 应作为本组的说明文本归档，组状态才能正确落为 done。
      const key = toolKey(event)
      if (key === null) continue
      const existing = actions.find((action): action is Extract<TraceAction, { kind: 'tool' }> => action.kind === 'tool' && (action.toolCallId ?? `tool:${action.tool}`) === key)
      if (existing) {
        existing.status = event.status === 'failed' ? 'failed' : 'done'
        existing.durationMs = event.durationMs ?? existing.durationMs
      } else {
        // 异常顺序（result 先到）：补齐动作，避免组里漏掉已完成工具。
        actions.push({ kind: 'tool', tool: event.tool ?? 'tool', toolCallId: event.toolCallId ?? null, input: event.input ?? null, status: event.status === 'failed' ? 'failed' : 'done', durationMs: event.durationMs ?? null })
      }
      checkTextBoundary(event)
      continue
    }
    // 文本分段点：正文在该事件之前又长出来了，先把上一组与说明文本固化。
    checkTextBoundary(event)
    if (event.type === 'file_changed') {
      applyFileChange(actions, event)
      continue
    }
    if (event.type === 'user_steer') {
      // 当前动作组只挂一次，后续结果继续更新同一引用；补充本身是独立的时间线节点。
      if (actions.length && !segmentedGroup) {
        segmentedGroup = { actions, status: groupStatus(actions) }
        segments.push({ kind: 'group', group: segmentedGroup })
      }
      // 只带附件不带正文的补充同样要出节点，否则界面上这条补充凭空消失。
      const attachments = event.attachments ?? []
      if (event.text || attachments.length > 0) segments.push({ kind: 'steer', text: event.text ?? '', attachments })
      continue
    }
    if (event.type === 'thinking_started') {
      thinkingActive = true
      actions.push({ kind: 'thinking', status: 'running' })
      continue
    }
    if (event.type === 'thinking_ended') {
      thinkingActive = false
      // 一组内可能有多轮思考，只结算最近一个未结束的；否则后面几轮永远停在 running，
      // 整组跟着卡在「Thinking」转圈。
      const thinking = [...actions].reverse().find((action) => action.kind === 'thinking' && action.status === 'running')
      if (thinking && thinking.kind === 'thinking') thinking.status = 'done'
      continue
    }
    const key = toolKey(event)
    if (key === null) continue
    settleThinking(actions)
    const existing = actions.find((action): action is Extract<TraceAction, { kind: 'tool' }> => action.kind === 'tool' && (action.toolCallId ?? `tool:${action.tool}`) === key)
    if (!existing) {
      actions.push({
        kind: 'tool',
        tool: event.tool ?? 'tool',
        toolCallId: event.toolCallId ?? null,
        input: event.input ?? null,
        status: event.type === 'approval_required' || event.type === 'question_required' ? 'waiting' : 'running',
        durationMs: null
      })
    }
  }
  const pendingGroup = actions.length && !segmentedGroup ? { actions, status: groupStatus(actions) } : null
  return {
    segments,
    pendingGroup,
    answerStart: cursor,
    hasActivity: pendingGroup !== null || segments.some((segment) => segment.kind === 'group') || thinkingActive
  }
}

/**
 * 本回合的 token 合计（输入 + 输出，含缓存读写）。
 * 优先取最后一条 usageUpdated 的回合聚合；没有聚合（旧回合只落了逐次记录）时按记录求和。
 * 两者都没有、或合计为 0（请求还没回来就被取消）时返回 null，底栏据此不画 token 段，而不是显示一个 0。
 */
export function traceTokenTotal(events: AgentEvent[]): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const turn = events[index].usage?.turn
    if (turn) return turn.inputTokens + turn.outputTokens > 0 ? turn.inputTokens + turn.outputTokens : null
  }
  let total = 0
  let found = false
  for (const event of events) {
    const record = event.usageRecord
    if (!record) continue
    found = true
    total += record.inputTokens + record.outputTokens + record.cacheReadTokens + record.cacheWriteTokens
  }
  return found && total > 0 ? total : null
}

/**
 * 轨迹里有没有真正的工具/子代理动作（思考不算）。
 * chat 模式现在也能调工具，用它决定该渲染执行轨迹还是轻量的分析过程卡：
 * 只有思考的旧对话回合仍走旧展示，不会因为放开工具而整体换样式。
 */
export function hasToolAction(trace: ExecutionTrace): boolean {
  const groupHasTool = (group: TraceGroup) => group.actions.some((action) => action.kind !== 'thinking')
  return trace.segments.some((segment) => segment.kind === 'group' && groupHasTool(segment.group))
    || (trace.pendingGroup !== null && groupHasTool(trace.pendingGroup))
}

/** 组在轨迹里的位置：数字是 segments 下标，'pending' 是尚未收尾的组。 */
export type ThinkingGroupKey = number | 'pending'

function thinkingRounds(group: TraceGroup): number {
  return group.actions.filter((action) => action.kind === 'thinking').length
}

/**
 * 把思考正文按轮次分给各个含 Thinking 的组：分段与 thinking_started 一一对应，
 * 组里有几个 Thinking 动作就领走几段。
 * 旧回合只有一份全文（没有 thinkingSegments），退回旧行为挂在第一个组上，
 * 否则每个组都会重复同一段文本。
 */
export function thinkingTextByGroup(trace: ExecutionTrace, segments: string[] | undefined, fullText: string): Map<ThinkingGroupKey, string> {
  const result = new Map<ThinkingGroupKey, string>()
  const targets: Array<{ key: ThinkingGroupKey; rounds: number }> = []
  trace.segments.forEach((segment, index) => {
    if (segment.kind !== 'group') return
    const rounds = thinkingRounds(segment.group)
    if (rounds > 0) targets.push({ key: index, rounds })
  })
  const pendingRounds = trace.pendingGroup ? thinkingRounds(trace.pendingGroup) : 0
  if (pendingRounds > 0) targets.push({ key: 'pending', rounds: pendingRounds })
  if (!targets.length) return result
  if (!segments?.length) {
    if (fullText) result.set(targets[0].key, fullText)
    return result
  }
  // 直接首尾相接，不插分隔符：分段只是流式切片，一旦上游多切了几刀，
  // 插进去的换行就会把一段连续的推理打成「每行几个字」。段落由模型自己的换行决定。
  const join = (parts: string[]) => parts.filter(Boolean).join('')
  let cursor = 0
  for (const target of targets) {
    const text = join(segments.slice(cursor, cursor + target.rounds))
    cursor += target.rounds
    if (text) result.set(target.key, text)
  }
  // 分段比 Thinking 动作多（起止事件没成对落下来）时，多出来的挂到最后一个组，不能把内容丢掉。
  if (cursor < segments.length) {
    const last = targets[targets.length - 1].key
    const rest = join([result.get(last) ?? '', ...segments.slice(cursor)])
    if (rest) result.set(last, rest)
  }
  return result
}

/** 工具名 → 固定英文 Action；未收录的工具保留其名（首段大写），不硬猜语义。 */
const TOOL_VERB: Record<string, string> = {
  read: 'Read',
  ls: 'Read',
  grep: 'Search',
  find: 'Search',
  edit: 'Edit',
  patch: 'Edit',
  write: 'Create',
  rm: 'Delete',
  bash: 'Command',
  powershell: 'Command',
  todowrite: 'Plan'
}

function verbFor(tool: string): string {
  // MCP 工具名由服务器决定（mcp__Server__action），逐个展开只会刷屏且语义不可读，统一收敛成 Tool。
  if (tool.startsWith('mcp__')) return 'Tool'
  // 其余未收录的（skill / 自定义）工具保留原名，不硬猜 Action。
  return TOOL_VERB[tool] ?? tool
}

/** 计数格式全局统一为 `×N`：摘要行是执行记录不是正文，中文量词会把它读成一句话。 */
function countLabel(verb: string, count: number): string {
  return `${verb} ×${count}`
}

/**
 * 委派工具调用本身不进摘要与工具卡：它派出去的每个子任务已经各有一个 subagent 动作，
 * 两者并列会把同一件事说两遍（`subagent ×1 · Sub-agent scout ×2`）。
 */
export function isDelegationToolAction(action: TraceAction): boolean {
  return action.kind === 'tool' && action.tool === 'subagent'
}

/** 折叠态的思考标记用过去式，与执行中的 `Thinking` 区分开：一眼能看出这段已经结束。 */
const THINKING_VERB = 'Thinked'

/** 命令与搜索的入参不是文件名（是整条命令、整个关键字），写进摘要只会刷屏。 */
const PATH_VERBS = new Set(['Read', 'Edit', 'Create', 'Delete'])

interface VerbTally {
  verb: string
  count: number
  /** 只调用一次且入参是路径时的文件名；多次或拿不到时为 null，摘要改说个数。 */
  target: string | null
}

function tallyGroup(group: TraceGroup): VerbTally[] {
  const tallies: VerbTally[] = []
  for (const action of group.actions) {
    if (isDelegationToolAction(action)) continue
    const verb = action.kind === 'thinking' ? THINKING_VERB : action.kind === 'subagent' ? `Sub-agent ${action.agentName}` : verbFor(action.tool)
    const target = action.kind === 'tool' && PATH_VERBS.has(verb) ? traceFileName(action.input) : null
    const existing = tallies.find((item) => item.verb === verb)
    if (!existing) {
      tallies.push({ verb, count: 1, target })
      continue
    }
    existing.count += 1
    if (existing.target !== target) existing.target = null
  }
  return tallies
}

/** 中文自然语句；未收录的工具名保留原样并带计数，不硬翻。 */
function zhPhrase({ verb, count, target }: VerbTally): string {
  if (verb === THINKING_VERB) return '思考'
  if (verb.startsWith('Sub-agent ')) return count > 1 ? `运行 ${verb.slice(10)} ×${count}` : `运行 ${verb.slice(10)}`
  switch (verb) {
    case 'Read': return target ? `读取 ${target}` : `读取 ${count} 个文件`
    case 'Search': return `搜索 ${count} 次`
    case 'Edit': return target ? `修改 ${target}` : `修改 ${count} 个文件`
    case 'Create': return target ? `新建 ${target}` : `新建 ${count} 个文件`
    case 'Delete': return target ? `删除 ${target}` : `删除 ${count} 个文件`
    case 'Command': return `运行 ${count} 条命令`
    case 'Plan': return '更新计划'
    case 'Tool': return `调用 ${count} 个工具`
    default: return countLabel(verb, count)
  }
}

/** 英文自然语句；首字母由 traceGroupLabel 统一大写。 */
function enPhrase({ verb, count, target }: VerbTally): string {
  if (verb === THINKING_VERB) return 'thought'
  if (verb.startsWith('Sub-agent ')) return count > 1 ? `ran ${verb.slice(10)} ×${count}` : `ran ${verb.slice(10)}`
  switch (verb) {
    case 'Read': return target ? `read ${target}` : `read ${count} files`
    case 'Search': return count > 1 ? `searched ${count} times` : 'searched once'
    case 'Edit': return target ? `edited ${target}` : `edited ${count} files`
    case 'Create': return target ? `created ${target}` : `created ${count} files`
    case 'Delete': return target ? `deleted ${target}` : `deleted ${count} files`
    case 'Command': return count > 1 ? `ran ${count} commands` : 'ran a command'
    case 'Plan': return 'updated the plan'
    case 'Tool': return count > 1 ? `called ${count} tools` : 'called a tool'
    default: return countLabel(verb, count)
  }
}

/**
 * 组摘要。`compact` 是既有形态（`Thinked · Read ×2 · Command ×2`），
 * `zh` / `en` 折成一句自然语句（`读取 2 个文件，运行 3 条命令`）。
 * 默认值保持 compact：调用方一律显式传风格，缺省只服务于不关心文案的测试与旧调用。
 */
export function traceGroupLabel(group: TraceGroup, style: TraceLabelStyle = 'compact'): string {
  const tallies = tallyGroup(group)
  if (!tallies.length) return ''
  if (style === 'compact') {
    return tallies.map((item) => item.verb === THINKING_VERB ? THINKING_VERB : countLabel(item.verb, item.count)).join(' · ')
  }
  if (style === 'zh') return tallies.map(zhPhrase).join('，')
  const sentence = tallies.map(enPhrase).join(', ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** 增删行数的展示形态，两个数字分开给，颜色由界面按正负分。 */
export function formatDiffStat(diff: TraceDiffStat): { additions: string; deletions: string } {
  return { additions: `+${diff.additions}`, deletions: `-${diff.deletions}` }
}

const LIVE_LABEL: Record<string, string> = {
  Read: 'Reading…',
  Search: 'Searching…',
  Edit: 'Editing…',
  Create: 'Creating…',
  Delete: 'Deleting…',
  Command: 'Running command…',
  Test: 'Running tests…',
  Build: 'Building…',
  Plan: 'Planning…',
  Tool: 'Calling tool…'
}

const LIVE_LABEL_ZH: Record<string, string> = {
  Read: '正在读取…',
  Search: '正在搜索…',
  Edit: '正在修改…',
  Create: '正在新建…',
  Delete: '正在删除…',
  Command: '正在运行命令…',
  Test: '正在跑测试…',
  Build: '正在构建…',
  Plan: '正在更新计划…',
  Tool: '正在调用工具…'
}

/** 执行中的实时状态文案；组内没有未完成动作时返回 null（走静态摘要）。 */
export function traceGroupLiveLabel(group: TraceGroup, style: TraceLabelStyle = 'compact'): string | null {
  if (group.status !== 'running') return null
  // 跳过委派工具本身：它整段委派期间都在 running，会把状态行钉死在「subagent…」，
  // 盖掉真正在跑的子 Agent。
  const live = group.actions.filter((action) => (action.status === 'running' || action.status === 'waiting') && !isDelegationToolAction(action))
  const first = live[0]
  if (!first) return null
  const zh = style === 'zh'
  if (first.kind === 'thinking') return zh ? '正在思考' : 'Thinking'
  if (first.kind === 'subagent') {
    // 并行委派时把在跑的子代理都点出来，只说第一个会让人以为另一个没在跑。
    const names = [...new Set(live.filter((action): action is Extract<TraceAction, { kind: 'subagent' }> => action.kind === 'subagent').map((action) => action.agentName))]
    return zh ? `正在运行 ${names.join('、')}…` : `Running ${names.join(', ')}…`
  }
  const verb = verbFor(first.tool)
  const target = liveTarget(verb, first.input)
  return liveVerbLabel(verb, target, style)
}

/** 动作 + 对象的实时短语：`正在读取 App.tsx`；没有对象时退回 `正在读取…`。 */
function liveVerbLabel(verb: string, target: string | null, style: TraceLabelStyle): string {
  if (style === 'zh') {
    const label = LIVE_LABEL_ZH[verb] ?? `正在执行 ${verb}…`
    return target ? `${label.replace(/…$/, '')} ${target}` : label
  }
  const label = LIVE_LABEL[verb] ?? `${verb}…`
  return target ? `${label.replace(/…$/, '')} ${target}` : label
}

const LIVE_TARGET_MAX = 48

/**
 * 实时短语里的动作对象：路径类只留文件名，命令与搜索取首行并截断。
 * 过程头只有一行，整条命令或完整路径会把用时挤出去；MCP 等入参是 JSON 的不给对象。
 */
export function liveTarget(verb: string, input: string | null | undefined): string | null {
  if (!input) return null
  if (PATH_VERBS.has(verb)) return traceFileName(input)
  if (verb !== 'Command' && verb !== 'Test' && verb !== 'Build' && verb !== 'Search') return null
  const line = (input.trim().startsWith('{') ? jsonTarget(input) : input.trim().split(/\r?\n/)[0]?.trim()) ?? ''
  if (!line) return null
  return line.length > LIVE_TARGET_MAX ? `${line.slice(0, LIVE_TARGET_MAX)}…` : line
}

/** grep / find 的入参被摘要成 JSON；取出关键字，拿不到就不给对象。 */
function jsonTarget(input: string): string | null {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>
    const value = parsed.pattern ?? parsed.query ?? parsed.command
    return typeof value === 'string' ? value.trim().split(/\r?\n/)[0]?.trim() || null : null
  } catch {
    return null
  }
}

/**
 * 轨迹底栏的状态短语：执行中说当前在做什么，终态说结果。
 * 与顶部状态行的 `Working / Completed` 同源，只是这里要一句能读的话。
 */
export function traceRunStatusText(kind: 'working' | 'done' | 'failed' | 'cancelled' | 'interrupted', live: string | null, style: TraceLabelStyle): string {
  if (kind === 'working') {
    if (live) return live
    return style === 'zh' ? '正在执行…' : 'Running…'
  }
  if (style === 'zh') {
    const labels = { done: '已完成', failed: '执行失败', cancelled: '已取消', interrupted: '已中断' }
    return labels[kind]
  }
  const labels = { done: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' }
  return labels[kind]
}

/**
 * Sub-agent 卡片的动态行：执行中显示当前动作与累计进度，终态显示动作总数。
 * 返回 null 表示没有可展示的动态（如刚排队、或整轮没调用工具）。
 */
export function subAgentActivityLabel(action: Extract<TraceAction, { kind: 'subagent' }>): string | null {
  if (action.status !== 'running' && action.status !== 'waiting') {
    return action.toolCount > 0 ? `共 ${action.toolCount} 个动作` : null
  }
  const live = action.activity ? liveVerbLabel(action.activity, action.activityTarget ?? null, 'zh') : '启动中…'
  return action.toolCount > 0 ? `${live} · 已完成 ${action.toolCount} 个动作` : live
}

/** 状态行与组外的耗时格式：``1分58秒`` / ``45秒``；英文风格下是 ``1m 58s`` / ``45s``。 */
export function formatElapsed(ms: number, style: TraceLabelStyle = 'zh'): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (style === 'zh') return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}
