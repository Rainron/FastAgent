import { memo, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Ban, Check, ChevronRight, Circle, LoaderCircle, Pause, X } from 'lucide-react'
import type { ConversationTurn, TurnActivity } from '../../shared/types'
import { formatElapsed, isDelegationToolAction, subAgentActivityLabel, thinkingTextByGroup, traceGroupLabel, traceGroupLiveLabel, type ExecutionTrace, type TraceGroup } from '../execution-trace'
import { ThinkingText } from './ThinkingText'
import { ToolCallCard } from './ToolCallCard'
import type { TraceAction } from '../execution-trace'
import { parseBlocks } from '../ai-response/block-parser'
import { MessageBlockRenderer } from '../ai-response/MessageBlockRenderer'

export type RunKind = Exclude<TurnActivity['status'], 'idle'>

const STATUS_TEXT: Record<RunKind, string> = {
  working: 'Working',
  done: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted'
}

/** 状态图标：● 进行中、✓ 已完成、× 失败、⊘ 已取消、‖ 已暂停（可继续）。颜色由 CSS 按 kind 给。 */
const STATUS_ICON: Record<RunKind, ReactElement> = {
  working: <Circle size={9} fill="currentColor" strokeWidth={0} />,
  done: <Check size={12} />,
  failed: <X size={12} />,
  cancelled: <Ban size={11} />,
  interrupted: <Pause size={11} fill="currentColor" strokeWidth={0} />
}

/** 执行中的文本段固定（已归档），不参与流式；语义与正文区一致，只是位置不同。 */
function TraceTextBlock({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text, 'trace-text'), [text])
  if (!blocks.length) return null
  return <div className="trace-text">{blocks.map((block) => <MessageBlockRenderer key={block.id} block={block} />)}</div>
}

/**
 * 单个 Sub-agent 的卡片。子 Agent 的流式正文不回传主进程（逐 token 转发会把主进程写死），
 * 因此动态只能靠工具级进度：当前动作 + 已完成动作数。
 */
function SubAgentCard({ action }: { action: Extract<TraceAction, { kind: 'subagent' }> }) {
  const runningNow = action.status === 'running' || action.status === 'waiting'
  const activity = subAgentActivityLabel(action)
  return (
    <div className={`trace-subagent-card ${action.status}`}>
      <div className="trace-subagent-head">
        <strong>{action.agentName}</strong>
        <span className="trace-subagent-status">{runningNow ? '执行中' : action.status === 'failed' ? '失败' : '已完成'}</span>
        {runningNow && <LoaderCircle size={11} className="spin" />}
      </div>
      {activity && <div className="trace-subagent-activity">{activity}</div>}
      <p className="trace-subagent-task">{action.task || '局部只读任务'}</p>
      {!runningNow && <small>结果已回传主 Agent，需由主 Agent 复核</small>}
      {action.handoff && <div className="trace-subagent-handoff">
        <b>交接摘要</b>
        {action.handoff.goal && <p>目标：{action.handoff.goal}</p>}
        {action.handoff.verified.length > 0 && <p>已验证：{action.handoff.verified.join('；')}</p>}
        {action.handoff.unverified.length > 0 && <p>未验证：{action.handoff.unverified.join('；')}</p>}
        {action.handoff.findings.length > 0 && <p>发现：{action.handoff.findings.join('；')}</p>}
        {action.handoff.remainingSteps.length > 0 && <p>剩余步骤：{action.handoff.remainingSteps.join('；')}</p>}
      </div>}
    </div>
  )
}

/** 单个动作组：折叠时一行摘要，整行点击展开后逐条列出工具调用（复用 ToolCallCard 的详情与落库记录）。 */
function TraceGroupBlock({ group, turnId, workspaceRoot, activeEventId, thinking }: { group: TraceGroup; turnId: string; workspaceRoot: string | null; activeEventId?: string | null; thinking?: string }) {
  const [override, setOverride] = useState<boolean | null>(null)
  // Sub-agent 与 Thinking 也算「在跑」：只看普通工具会让思考组显示成静态摘要。
  const thinkingRunning = group.actions.some((action) => action.kind === 'thinking' && action.status === 'running')
  const running = group.status === 'running' && (!activeEventId || thinkingRunning || group.actions.some((action) => (action.kind === 'tool' || action.kind === 'subagent') && action.status === 'running'))
  const live = running ? traceGroupLiveLabel(group) : null
  const label = live ?? traceGroupLabel(group)
  // 委派工具调用不单独出卡：参数已经以任务文本的形式显示在下方的 Sub-agent 卡片里。
  const tools = group.actions.filter((action): action is Extract<TraceAction, { kind: 'tool' }> => action.kind === 'tool' && !isDelegationToolAction(action))
  const subagents = group.actions.filter((action): action is Extract<TraceAction, { kind: 'subagent' }> => action.kind === 'subagent')
  // 只有 Sub-agent 没有普通工具的组同样有可展开内容，否则卡片永远打不开。
  // 纯 Thinking 组拿到本轮思考正文时才可展开；拿不到（模型没产出思考块）时保持静态，不给空入口。
  const expandable = tools.length > 0 || subagents.length > 0 || Boolean(thinking)
  // 有 Sub-agent 在跑时默认展开：委派可能持续几分钟，折叠着就只剩一个转圈，看不到任何动态。
  // 思考不在此列：思考正文一律折叠，由用户点开。用户手动切换后以手动值为准。
  const open = override ?? subagents.some((action) => action.status === 'running')
  const summary = <>
    <span className="trace-group-label">{label}</span>
    {/* 不可展开时不画箭头：箭头是「点我展开」的承诺，画了却点不动就是坏交互。 */}
    <span className="trace-group-icon">{running && !thinkingRunning && <LoaderCircle size={11} className="spin" />}{expandable && <ChevronRight size={12} className="trace-group-chevron" />}</span>
  </>
  return (
    <div className={`trace-group ${group.status} ${open ? 'open' : ''}`}>
      {/* 没有工具的组（纯 Thinking）没有可展开内容，保持非交互，避免点了没反应。 */}
      {expandable
        ? <button type="button" className="trace-group-summary" onClick={() => setOverride(!open)} aria-expanded={open} title={open ? '收起' : '展开'}>{summary}</button>
        : <div className="trace-group-summary static">{summary}</div>}
      {open && <div className="trace-group-detail">
        {thinking && <ThinkingText id={`${turnId}-thinking`} text={thinking} className="trace-thinking" />}
        {subagents.map((action) => <SubAgentCard key={action.taskId} action={action} />)}
        {tools.map((action, index) => <ToolCallCard
          key={action.toolCallId ?? `tool-${index}`}
          turnId={turnId}
          group={{ toolCallId: action.toolCallId ?? '', toolName: action.tool, events: [] }}
          summary={{ input: action.input, status: action.status, durationMs: action.durationMs }}
          workspaceRoot={workspaceRoot}
        />)}
      </div>}
    </div>
  )
}

/**
 * 内联执行轨迹：顶部一行运行状态（整行点击展开），下方按真实顺序展示动作组与说明文本段。
 * 展开态从 run 状态派生：执行中展开以便跟进进度，终态折叠让最终回答成为主体。
 * 用户手动切换只在当前 run 状态内生效，状态一变就回到派生默认值。
 */
export function ExecutionTrace({ turn, trace, startedAt, finishedAt, kind }: {
  turn: ConversationTurn
  trace: ExecutionTrace
  startedAt: number | null
  finishedAt: number | null
  kind: RunKind
}) {
  const [override, setOverride] = useState<{ kind: RunKind; open: boolean } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (kind !== 'working') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [kind])
  const expanded = override?.kind === kind ? override.open : kind === 'working'
  const workspaceRoot = turn.runtimeConfig?.project ?? null
  const startMs = startedAt ?? 0
  const elapsedMs = finishedAt !== null ? Math.max(0, finishedAt - startMs) : Math.max(0, now - startMs)
  const timeText = kind === 'working' ? formatElapsed(elapsedMs) : `用时 ${formatElapsed(elapsedMs)}`
  const fullText = turn.activity?.transcript ?? turn.assistantMessage?.text ?? ''
  const activeEventId = turn.activity?.execution?.activeEventId ?? null
  // 思考正文按轮次分给各个 Thinking 组；执行中由渲染进程的思考缓冲实时补，终态由主进程全量覆盖。
  const thinkingText = turn.activity?.thinking?.trim() ?? ''
  const thinkingSegments = turn.activity?.thinkingSegments
  const thinkingByGroup = useMemo(() => thinkingTextByGroup(trace, thinkingSegments, thinkingText), [trace, thinkingSegments, thinkingText])
  // 有思考正文却没有任何 Thinking 组（provider 只发 thinking_delta 不发起止事件）时补一个组，
  // 否则这段思考在轨迹上完全没有入口。
  const thinkingFallback = thinkingText && thinkingByGroup.size === 0
    ? { actions: [{ kind: 'thinking' as const, status: kind === 'working' ? 'running' as const : 'done' as const }], status: kind === 'working' ? 'running' as const : 'done' as const }
    : null

  const toggle = () => setOverride({ kind, open: !expanded })

  return (
    <section className={`execution-trace ${kind} ${expanded ? 'expanded' : 'collapsed'}`}>
      <button type="button" className="run-status" onClick={toggle} aria-expanded={expanded} title={expanded ? '收起执行过程' : '展开执行过程'}>
        <span className="run-status-icon" aria-hidden="true">{STATUS_ICON[kind]}</span>
        <span className={`run-status-text ${kind}`}>{STATUS_TEXT[kind]}</span>
        <span className="run-status-time">{timeText}</span>
        <ChevronRight size={12} className="run-status-chevron" />
      </button>
      {expanded && <div className="execution-trace-body">
        {trace.segments.map((segment, index) => segment.kind === 'group'
          ? <TraceGroupBlock key={`g-${index}`} group={segment.group} activeEventId={activeEventId} turnId={turn.id} workspaceRoot={workspaceRoot} thinking={thinkingByGroup.get(index)} />
          : <TraceTextBlock key={`t-${index}`} text={fullText.slice(Math.min(segment.start, fullText.length), Math.min(segment.end, fullText.length))} />)}
        {trace.pendingGroup && <TraceGroupBlock group={trace.pendingGroup} activeEventId={activeEventId} turnId={turn.id} workspaceRoot={workspaceRoot} thinking={thinkingByGroup.get('pending')} />}
        {thinkingFallback && <TraceGroupBlock group={thinkingFallback} activeEventId={activeEventId} turnId={turn.id} workspaceRoot={workspaceRoot} thinking={thinkingText} />}
        {!trace.hasActivity && !thinkingFallback && kind === 'working' && <div className="trace-empty">准备中…</div>}
        {!trace.hasActivity && !thinkingFallback && kind !== 'working' && <div className="trace-empty">本回合没有工具调用</div>}
      </div>}
    </section>
  )
}

export const ExecutionTraceView = memo(ExecutionTrace)
