import type { AgentEvent } from '../shared/types'

/**
 * 内联执行轨迹的纯逻辑：把 turn 的事件流折成「动作组 + 文本段」交替序列。
 * 分段点 = Agent 可见正文输出：非 token 事件携带 textLength（截至该事件已输出的正文长度），
 * 一旦 textLength 超过已归档正文游标，说明模型在两段动作之间输出了说明文本，当前动作组收尾。
 * token 事件不落库，因此切分只依赖后续动作事件的 textLength，历史回放同样成立。
 */

export type TraceToolStatus = 'waiting' | 'running' | 'done' | 'failed'

export type TraceAction =
  | { kind: 'tool'; tool: string; toolCallId: string | null; input: string | null; status: TraceToolStatus; durationMs: number | null }
  | { kind: 'thinking'; status: 'running' | 'done' }
  | {
    kind: 'subagent'
    taskId: string
    agentName: string
    task: string | null
    status: TraceToolStatus
    /** 子 Agent 当前动作（已归一成 Action 名）；没有在跑的动作时为 null。 */
    activity: string | null
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
  /** 正文切片 [start, end)，紧随前一动作组之后展示。 */
  | { kind: 'text'; start: number; end: number }

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
    return
  }
  if (event.type !== 'subagent_update' || !event.tool) return
  action.activity = verbFor(event.tool)
  if (event.status === 'completed' || event.status === 'failed') action.toolCount += 1
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

export function buildExecutionTrace(events: AgentEvent[]): ExecutionTrace {
  const segments: TraceSegment[] = []
  let actions: TraceAction[] = []
  // 已归档正文的游标；<= 它的部分要么进了文本段，要么在正文区。
  let cursor = 0
  let thinkingActive = false

  const flush = (unfinished: 'done' | 'failed' = 'done') => {
    if (!actions.length) return
    settleActions(actions, unfinished)
    segments.push({ kind: 'group', group: { actions, status: groupStatus(actions) } })
    actions = []
  }

  // 文本分段点：正文在该事件之前又长出来了，固化上一组并归档说明文本。
  const checkTextBoundary = (event: AgentEvent) => {
    if (event.textLength === undefined || event.textLength <= cursor) return
    flush()
    segments.push({ kind: 'text', start: cursor, end: event.textLength })
    cursor = event.textLength
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
        applySubAgentProgress(existing, event)
      } else {
        const action: Extract<TraceAction, { kind: 'subagent' }> = { kind: 'subagent', taskId: event.subAgent.taskId, agentName: event.subAgent.agentName, task: event.input ?? null, status, activity: null, toolCount: 0, parentRunId: event.subAgent.parentRunId, subAgentRunId: event.subAgent.subAgentRunId, handoff: event.subAgent.handoff }
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
  const pendingGroup = actions.length ? { actions, status: groupStatus(actions) } : null
  return {
    segments,
    pendingGroup,
    answerStart: cursor,
    hasActivity: pendingGroup !== null || segments.some((segment) => segment.kind === 'group') || thinkingActive
  }
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

/** 组摘要：`Thinked · Read ×2 · Command ×2`；思考固定排在首位。 */
export function traceGroupLabel(group: TraceGroup): string {
  const counts = new Map<string, number>()
  const order: string[] = []
  for (const action of group.actions) {
    if (isDelegationToolAction(action)) continue
    const verb = action.kind === 'thinking' ? THINKING_VERB : action.kind === 'subagent' ? `Sub-agent ${action.agentName}` : verbFor(action.tool)
    const first = !counts.has(verb)
    if (first) order.push(verb)
    counts.set(verb, (counts.get(verb) ?? 0) + (verb === THINKING_VERB ? 0 : 1))
  }
  return order.map((verb) => verb === THINKING_VERB ? THINKING_VERB : countLabel(verb, counts.get(verb) ?? 0)).join(' · ')
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

/** 执行中的实时状态文案；组内没有未完成动作时返回 null（走静态摘要）。 */
export function traceGroupLiveLabel(group: TraceGroup): string | null {
  if (group.status !== 'running') return null
  // 跳过委派工具本身：它整段委派期间都在 running，会把状态行钉死在「subagent…」，
  // 盖掉真正在跑的子 Agent。
  const first = group.actions.find((action) => (action.status === 'running' || action.status === 'waiting') && !isDelegationToolAction(action))
  if (!first) return null
  if (first.kind === 'thinking') return 'Thinking'
  if (first.kind === 'subagent') return `Running ${first.agentName}…`
  return LIVE_LABEL[verbFor(first.tool)] ?? `${verbFor(first.tool)}…`
}

/**
 * Sub-agent 卡片的动态行：执行中显示当前动作与累计进度，终态显示动作总数。
 * 返回 null 表示没有可展示的动态（如刚排队、或整轮没调用工具）。
 */
export function subAgentActivityLabel(action: Extract<TraceAction, { kind: 'subagent' }>): string | null {
  if (action.status !== 'running' && action.status !== 'waiting') {
    return action.toolCount > 0 ? `共 ${action.toolCount} 个动作` : null
  }
  const live = action.activity ? LIVE_LABEL[action.activity] ?? `${action.activity}…` : '启动中…'
  return action.toolCount > 0 ? `${live} · 已完成 ${action.toolCount} 个动作` : live
}

/** 状态行与组外的耗时格式：``1分58秒`` / ``45秒``。 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`
}
