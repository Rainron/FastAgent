import { Fragment, memo, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { ArrowUp, Ban, Check, ChevronRight, Circle, CornerDownRight, Layers, LoaderCircle, Paperclip, Pause, Sparkles, X } from 'lucide-react'
import type { Attachment, ConversationTurn, TraceLabelStyle, TurnActivity } from '../../shared/types'
import { formatTokenCount, traceDefaultOpen } from '../../shared/trace-display'
import { useResponseActions } from '../ai-response/response-context'
import { AttachmentImage, isImageAttachment } from './AttachmentImage'
import { useScrollAnchor } from '../scroll-anchor'
import { formatDiffStat, formatElapsed, isDelegationToolAction, thinkingTextByGroup, traceAnswerStart, traceGroupDiff, traceGroupLabel, traceGroupLiveLabel, traceOutcomeLabel, traceRunStatusText, traceSummary, traceSummaryLabel, traceTokenTotal, type ExecutionTrace, type TraceGroup } from '../execution-trace'
import { thinkingHeadline, thinkingPreview } from './thinking-preview'
import { usePinnedHead } from './hooks/use-pinned-head'
import { motionEnabled } from '../motion'
import { useTraceDisplay } from './trace-display-context'
import { ThinkingText } from './ThinkingText'
import { ToolCallCard } from './ToolCallCard'
import type { TraceAction } from '../execution-trace'
import { parseBlocks } from '../ai-response/block-parser'
import { MessageBlockRenderer } from '../ai-response/MessageBlockRenderer'
import { SubAgentStrip } from './SubAgentStrip'
import { Collapse } from '../Collapse'
import { collectSubAgents } from './subagent-view'

export type RunKind = Exclude<TurnActivity['status'], 'idle'>

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

/** 增删行数：`+199 -0`，两个数字分开着色。 */
function TraceDiffBadge({ additions, deletions }: { additions: number; deletions: number }) {
  const text = formatDiffStat({ additions, deletions })
  return <span className="trace-diff-stat">
    <span className="trace-diff-add">{text.additions}</span>
    <span className="trace-diff-del">{text.deletions}</span>
  </span>
}

/** 单个动作组：一行摘要，展开后逐条列出工具调用。补充消息由父级作为平行节点渲染。 */
function TraceGroupBlock({ group, turnId, workspaceRoot, activeEventId, thinking, detailsVisible }: { group: TraceGroup; turnId: string; workspaceRoot: string | null; activeEventId?: string | null; thinking?: string; detailsVisible: boolean }) {
  const [override, setOverride] = useState<boolean | null>(null)
  const display = useTraceDisplay()
  // 收起时详情区整块消失，不锁住摘要行的话它下面的内容会整段往上跳。
  const { ref: summaryRef, anchor } = useScrollAnchor<HTMLButtonElement>()
  // Sub-agent 与 Thinking 也算「在跑」：只看普通工具会让思考组显示成静态摘要。
  const thinkingRunning = group.actions.some((action) => action.kind === 'thinking' && action.status === 'running')
  const running = group.status === 'running' && (!activeEventId || thinkingRunning || group.actions.some((action) => (action.kind === 'tool' || action.kind === 'subagent') && action.status === 'running'))
  const live = running ? traceGroupLiveLabel(group, display.labelStyle) : null
  const label = live ?? traceGroupLabel(group, display.labelStyle)
  const groupDiff = display.showDiffStats ? traceGroupDiff(group) : null
  // 委派工具调用不单独出卡；子代理也不在组里出卡——它们常驻在过程头下方的子代理行，详情去右侧面板看。
  const tools = group.actions.filter((action): action is Extract<TraceAction, { kind: 'tool' }> => action.kind === 'tool' && !isDelegationToolAction(action))
  // 补充消息不是模型动作，父级会把它作为与本组摘要平行的节点渲染。
  // 纯 Thinking 组拿到本轮思考正文时才可展开；拿不到（模型没产出思考块）时保持静态，不给空入口。
  const expandable = tools.length > 0 || Boolean(thinking)
  // 一律默认折叠：动态由组摘要那行的实时文案承担（`正在读取 App.tsx`），要看细节由用户点开。
  const open = detailsVisible && (override ?? false)
  // 收起的思考组只剩一句「正在思考」，看不出在推理还是卡住；把最新一句思考挂在下面，随流式更新。
  const preview = useMemo(() => thinkingRunning && !open && thinking ? thinkingPreview(thinking) : null, [thinkingRunning, open, thinking])
  const summary = <>
    <span className="trace-group-label">{label}</span>
    {groupDiff && <TraceDiffBadge additions={groupDiff.additions} deletions={groupDiff.deletions} />}
    {/* 不可展开时不画箭头：箭头是「点我展开」的承诺，画了却点不动就是坏交互。 */}
    <span className="trace-group-icon">{running && !thinkingRunning && <LoaderCircle size={11} className="spin" />}{expandable && <ChevronRight size={12} className="trace-group-chevron" />}</span>
  </>
  return (
    <div className={`trace-group ${group.status} ${open ? 'open' : ''}`}>
      {/* 没有工具的组（纯 Thinking）没有可展开内容，保持非交互，避免点了没反应。 */}
      {expandable && detailsVisible
        ? <button type="button" ref={summaryRef} className="trace-group-summary" onClick={() => { anchor(); setOverride(!open) }} aria-expanded={open} title={open ? '收起' : '展开'}>{summary}</button>
        : <div className="trace-group-summary static">{summary}</div>}
      {preview && <p className="trace-live-preview">{preview}</p>}
      {/* 收起也要过渡：一帧消失会让下面的内容整段跳上来。首次挂载已展开时不播动画。 */}
      <Collapse open={open} appear={false}><div className="trace-group-detail">
        {thinking && <ThinkingText id={`${turnId}-thinking`} text={thinking} className="trace-thinking" />}
        {/* 工具行收进一张列表卡：逐条平铺时行与行没有边界，长轨迹读起来就是一坨 */}
        {tools.length > 0 && <div className="trace-tool-list">
          {tools.map((action, index) => <ToolCallCard
            key={action.toolCallId ?? `tool-${index}`}
            turnId={turnId}
            group={{ toolCallId: action.toolCallId ?? '', toolName: action.tool, events: [] }}
            summary={{ input: action.input, status: action.status, durationMs: action.durationMs, diff: action.diff ?? null }}
            workspaceRoot={workspaceRoot}
          />)}
        </div>}
      </div></Collapse>
    </div>
  )
}

/**
 * 用户在这一轮中途插入的补充：标题行标出来源与附件数，正文与附件依次排下。
 * 附件走消息区同一套渲染（图片出缩略图、其余给 chip），补充里带的图不能只剩一句「已送达」。
 */
function TraceSteer({ text, attachments }: { text: string; attachments: Attachment[] }) {
  const actions = useResponseActions()
  return (
    <div className="trace-steer">
      <div className="trace-steer-head">
        <span className="trace-steer-mark" aria-hidden="true"><CornerDownRight size={11} /></span>
        <strong>插入补充</strong>
        {attachments.length > 0 && <span className="trace-steer-count"><Paperclip size={10} />{attachments.length}</span>}
      </div>
      {text && <p className="trace-steer-text">{text}</p>}
      {attachments.length > 0 && <div className="trace-steer-files">
        {attachments.map((attachment) => isImageAttachment(attachment)
          ? <AttachmentImage key={attachment.id} attachment={attachment} onOpen={actions.openAttachment} />
          : <button type="button" className="attachment-chip" key={attachment.id} title={`预览 ${attachment.name}`} onClick={() => actions.openAttachment(attachment)}><Paperclip size={12} />{attachment.name}</button>)}
      </div>}
    </div>
  )
}

/**
 * 内联执行轨迹，自上而下三段：过程头（唯一展开入口）→ 动作详情 → 最终回答 → 收尾行。
 *
 * 展开入口必须排在它所展开的内容上方：入口放在底部时，点一下内容全从上面冒出来，
 * 点击点以上的一切都被推走，用户看不到自己展开了什么。
 * 正文只有一个挂载位置，不随展开状态换父节点，切换状态时回答的位置与缩进都不变。
 * 默认展开状态由设置决定（默认始终收起，过程头一行实时说当前动作）；用户手动切换只在当前 run 状态内生效。
 * 子代理行排在过程头正下方且不随折叠隐藏：委派出去的任务往往跑得最久，收起时也得看得到它们在干什么。
 */
export function ExecutionTrace({ turn, trace, startedAt, finishedAt, kind, renderAnswer, actions, outcome, meta, onJumpToContext }: {
  turn: ConversationTurn
  trace: ExecutionTrace
  startedAt: number | null
  finishedAt: number | null
  kind: RunKind
  /** 由调用方提供正文渲染函数，轨迹只决定正文切片和展示位置。 */
  renderAnswer: (textStart: number) => ReactNode
  /** 本轮的操作条（复制 / 重新生成 / 更多）；与用时、token 同属收尾信息，排在同一行里。 */
  actions?: ReactNode
  /** 没有回答可看时（取消在出字之前）给的下一步，排在正文位置。 */
  outcome?: ReactNode
  /** 正文区没渲染时，本该在回答头上的「模型 · 时间」挪到收尾行。 */
  meta?: string
  /** 本轮有上下文来源时，吸顶条上多一个入口，点了跳回那一栏。 */
  onJumpToContext?: () => void
}) {
  const [override, setOverride] = useState<{ kind: RunKind; open: boolean } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const display = useTraceDisplay()
  // 收起时详情区整块消失，锁住过程头的位置，免得它下面的回答整段跳走。
  const { ref: headRef, anchor: anchorHead } = useScrollAnchor<HTMLButtonElement>()
  useEffect(() => {
    if (kind !== 'working') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [kind])
  const expanded = override?.kind === kind ? override.open : traceDefaultOpen(display.defaultExpand, kind)
  const workspaceRoot = turn.runtimeConfig?.project ?? null
  const startMs = startedAt ?? 0
  const elapsedMs = finishedAt !== null ? Math.max(0, finishedAt - startMs) : Math.max(0, now - startMs)
  const style: TraceLabelStyle = display.labelStyle
  const elapsedText = formatElapsed(elapsedMs, style)
  const timeText = kind === 'working' ? elapsedText : style === 'zh' ? `用时 ${elapsedText}` : `took ${elapsedText}`
  // timerPlacement 只管终态的「用时 / token 显示在哪」。执行中的计时是实时状态的一部分，
  // 一律跟在状态文字后面：放到底部，「正在思考」和「27秒」就隔着整段正文。
  const showHeadTimer = kind === 'working' || display.timerPlacement !== 'bottom'
  const showFooterTimer = kind !== 'working' && display.timerPlacement !== 'top'
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

  const toggle = () => { anchorHead(); setOverride({ kind, open: !expanded }) }

  // 过程头的实时短语跟着最后一个在跑的组走；终态改说这一轮做了多少事。
  const runningGroup = trace.pendingGroup ?? [...trace.segments].reverse().find((segment): segment is { kind: 'group'; group: TraceGroup } => segment.kind === 'group' && segment.group.status === 'running')?.group ?? null
  const liveLabel = kind === 'working' && runningGroup ? traceGroupLiveLabel(runningGroup, style) : null
  // 思考阶段过程头用模型自己写的小标题（`对比终态文案`），比千篇一律的「正在思考」多一层信息
  const thinkingLive = kind === 'working' && (Boolean(thinkingFallback) || Boolean(runningGroup?.actions.some((action) => action.kind === 'thinking' && action.status === 'running')))
  const headline = thinkingLive ? thinkingHeadline(thinkingText) : null
  const tokenTotal = display.showTokens ? traceTokenTotal(turn.activity?.events ?? []) : null
  const summary = useMemo(() => traceSummary(trace), [trace])
  const subagents = useMemo(() => collectSubAgents(trace), [trace])
  const headDiff = display.showDiffStats ? summary.diff : null
  // 没有任何动作也没有思考的回合不给过程头：点开只会看到一句「本回合没有工具调用」。
  const hasProcess = trace.hasActivity || Boolean(thinkingFallback) || kind === 'working'
  const open = expanded && hasProcess
  const toggleTitle = open ? '收起执行过程' : '展开执行过程'
  // 收起时头部替下面的动作组说话（「正在运行 scout…」）；展开后动作组自己在说，头部换成累计口径，
  // 否则同一句实时状态会在上下两行同时出现。终态头部说结果，收尾行不再重复。
  const headLabel = kind === 'working'
    ? open ? traceSummaryLabel(summary, style) : headline ?? traceRunStatusText(kind, liveLabel, style)
    : traceOutcomeLabel(kind, summary, style)
  const headPreview = thinkingLive && !open ? thinkingPreview(thinkingText) : null
  // 吸顶条永远说「现在怎样」：展开时过程头换成了累计口径，条上仍给实时状态或结果
  const pinned = usePinnedHead(headRef, hasProcess)
  const stickyLabel = kind === 'working' ? headline ?? traceRunStatusText(kind, liveLabel, style) : traceOutcomeLabel(kind, summary, style)
  const jumpToHead = () => headRef.current?.scrollIntoView({ block: 'start', behavior: motionEnabled() ? 'smooth' : 'auto' })
  // 没有过程头（整轮没有动作）时结果只能由收尾行来说
  const footerStatus = kind !== 'working' && !hasProcess ? traceRunStatusText(kind, liveLabel, style) : null
  const footerStats = [
    footerStatus && <span key="status" className="trace-runbar-status">{footerStatus}</span>,
    showFooterTimer && <span key="time" className="trace-runbar-time">{elapsedText}</span>,
    showFooterTimer && tokenTotal !== null && <span key="tokens" className="trace-runbar-tokens">{formatTokenCount(tokenTotal)} tokens</span>,
    meta && <span key="meta" className="trace-runbar-meta">{meta}</span>
  ].filter(Boolean)

  return (
    <section className={`execution-trace ${kind} ${open ? 'expanded' : 'collapsed'}${pinned ? ' head-pinned' : ''}`}>
      {hasProcess && <div className={`trace-sticky${pinned ? ' pinned' : ''}`} aria-hidden={!pinned}>
        <div className="trace-sticky-bar">
          {onJumpToContext && <>
            <button type="button" className="trace-sticky-item" onClick={onJumpToContext} tabIndex={pinned ? 0 : -1} title="跳到本轮上下文"><Layers size={12} aria-hidden="true" />本轮上下文</button>
            <span className="trace-sticky-sep" aria-hidden="true" />
          </>}
          <button type="button" className="trace-sticky-item main" onClick={jumpToHead} tabIndex={pinned ? 0 : -1} title="跳到执行过程">
            <span className="run-status-icon" aria-hidden="true">{kind === 'working' ? <Sparkles size={12} /> : STATUS_ICON[kind]}</span>
            <span className="trace-sticky-label">{stickyLabel}</span>
            {kind === 'working' && <span className="run-status-time">{elapsedText}</span>}
            <ArrowUp size={12} className="trace-sticky-jump" aria-hidden="true" />
          </button>
        </div>
      </div>}
      {hasProcess && <button type="button" ref={headRef} className="run-status" onClick={toggle} aria-expanded={open} title={toggleTitle}>
        <span className="run-status-icon" aria-hidden="true">{kind === 'working' ? <Sparkles size={12} /> : STATUS_ICON[kind]}</span>
        <span className={`run-status-text ${kind}`}>{headLabel}</span>
        {headDiff && <TraceDiffBadge additions={headDiff.additions} deletions={headDiff.deletions} />}
        {showHeadTimer && <span className="run-status-time">{timeText}</span>}
        <ChevronRight size={12} className="run-status-chevron" />
      </button>}
      {headPreview && <p className="trace-live-preview head">{headPreview}</p>}
      {subagents.length > 0 && <SubAgentStrip turnId={turn.id} subagents={subagents} turnFinishedAt={finishedAt} />}
      <div className="execution-trace-body">
        <Collapse open={open} appear={false}><div className="execution-trace-details">
          {trace.segments.map((segment, index) => segment.kind === 'group'
            ? <TraceGroupBlock key={`g-${index}`} group={segment.group} activeEventId={activeEventId} turnId={turn.id} workspaceRoot={workspaceRoot} thinking={thinkingByGroup.get(index)} detailsVisible />
            : segment.kind === 'steer'
              ? <TraceSteer key={`s-${index}`} text={segment.text} attachments={segment.attachments ?? []} />
              : <TraceTextBlock key={`t-${index}`} text={fullText.slice(Math.min(segment.start, fullText.length), Math.min(segment.end, fullText.length))} />)}
          {trace.pendingGroup && <TraceGroupBlock group={trace.pendingGroup} activeEventId={activeEventId} turnId={turn.id} workspaceRoot={workspaceRoot} thinking={thinkingByGroup.get('pending')} detailsVisible />}
          {thinkingFallback && <TraceGroupBlock group={thinkingFallback} activeEventId={activeEventId} turnId={turn.id} workspaceRoot={workspaceRoot} thinking={thinkingText} detailsVisible />}
          {!trace.hasActivity && !thinkingFallback && kind === 'working' && <div className="trace-empty">准备中…</div>}
        </div></Collapse>
        {/* 正文固定挂在这里：展开只让它上方多出动作组，位置与缩进都不跟着状态跳 */}
        <div className="trace-answer">{renderAnswer(traceAnswerStart(kind, trace.answerStart))}</div>
        {outcome}
      </div>
      {/* 收尾行只在终态出现：左边结算（用时 · token · 模型），右边是对这一轮的操作。
          执行中计时已跟在过程头的状态后面，这里再放一份就是同一个数字出现两次。 */}
      {kind !== 'working' && <div className={`trace-runbar ${kind}`}>
        {footerStats.length > 0 && <span className="trace-runbar-stat">
          {footerStatus && <span className="trace-runbar-icon" aria-hidden="true">{STATUS_ICON[kind]}</span>}
          {footerStats.map((item, index) => <Fragment key={index}>{index > 0 && <span className="trace-runbar-dot" aria-hidden="true">·</span>}{item}</Fragment>)}
        </span>}
        {actions && <span className="trace-runbar-actions">{actions}</span>}
      </div>}
    </section>
  )
}

export const ExecutionTraceView = memo(ExecutionTrace)
