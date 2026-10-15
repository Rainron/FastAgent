import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Archive, ChevronRight, Copy, Edit3, FolderOpen, MoreHorizontal, Paperclip, Pause, Play, RotateCw, TerminalSquare, Trash2, Zap } from 'lucide-react'
import type { AgentEvent, Attachment, Citation, CompactionHistory, ConversationTurn, ModelOption, TodoItem } from '../../shared/types'
import { groupToolCallEvents } from '../activity'
import { AssistantMessageView, assistantPlainText } from '../ai-response/AssistantMessage'
import { MessageActions as AssistantMessageActions } from '../ai-response/MessageActions'
import { normalizeFlagEmoji } from '../ai-response/flag-emoji'
import { openExternalLink, useResponseActions } from '../ai-response/response-context'
import { sanitizeLinkHref } from '../ai-response/sanitize-url'
import { appendAttachments, attachmentsFromClipboard } from '../composer/attachments'
import { AttachmentImage, isImageAttachment } from './AttachmentImage'
import { buildExecutionTrace, hasToolAction, traceFinalAnswerLength } from '../execution-trace'
import { useDismiss } from '../use-dismiss'
import { useEventCallback } from '../use-event-callback'
import { useDelayedUnmount } from '../use-delayed-unmount'
import { Collapse } from '../Collapse'
import { MOTION_DURATIONS, MOTION_EASING, motionEnabled } from '../motion'
import { detectRemovedTurns, mergeExitingTurns } from './exiting-turns'
import { ExecutionTraceView } from './ExecutionTrace'
import { buildCompactionMarkers } from './compaction-marker'
import { CompactionMarker } from './CompactionMarker'
import { modelChangeTurnIds } from './model-change-marker'
import { TodoPanel, type TodoRunStatus } from './TodoPanel'
import { ThinkingText } from './ThinkingText'
import { todoStats } from './todo-status'
import { ToolCallCard } from './ToolCallCard'
import { MemoryTurnBar } from './MemoryTurnBar'
import { ContextSourceBar } from './ContextSourceBar'
import { TurnChangesCard } from './TurnChangesCard'
import { ShellCommandCard } from './ShellCommandCard'
import { groupShellEntries, type ShellCommandEntry } from './shell-entries'
import { cancelledOutcome, traceMetaLine, type CancelledOutcome } from './turn-outcome'

export const MessageList = React.memo(function MessageList({ turns, models, todosByTurn, memoryTurnIds, contextSourceTurnIds, shellEntries, compactionHistory, contextWindow, onCancelShellCommand, onDismissShellCommand, onNotice, onCopy, onDelete, onRetry, onRegenerate, onEdit, onContinue, onShowContextMenu, planDisplayMode = 'inline' }: { turns: ConversationTurn[]; models: ModelOption[]; todosByTurn: Record<string, TodoItem[]>; memoryTurnIds: ReadonlySet<string>; contextSourceTurnIds: ReadonlySet<string>; shellEntries: ShellCommandEntry[]; compactionHistory?: CompactionHistory[]; contextWindow?: number; onCancelShellCommand: (id: string) => void; onDismissShellCommand: (id: string) => void; onNotice: (notice: string) => void; onCopy: (text: string) => void; onDelete: (turnId: string) => void; onRetry: (turn: ConversationTurn) => void; onRegenerate: (turn: ConversationTurn) => void; onEdit: (turn: ConversationTurn, text: string, attachments: Attachment[]) => void; onContinue: (turn: ConversationTurn) => void; onShowContextMenu: (event: React.MouseEvent, turn: ConversationTurn) => void; planDisplayMode?: 'top' | 'inline' }) {
  const modelChanges = useMemo(() => modelChangeTurnIds(turns), [turns])
  // 压缩分隔卡只跟回合的 id/createdAt 有关，流式期间正文变化不必重算。
  const turnAnchors = useMemo(() => turns.map((turn) => ({ id: turn.id, createdAt: turn.createdAt })), [turns])
  const compactionMarkers = useMemo(() => buildCompactionMarkers(turnAnchors, compactionHistory ?? []), [turnAnchors, compactionHistory])
  const renderCompaction = (records: CompactionHistory[] | undefined) => records?.map((record) =>
    <CompactionMarker key={record.id} record={record} contextWindow={contextWindow ?? 0} />)
  // 命令卡按锚点回合插回原位；turns 只取 id 参与依赖，流式期间回合内容变了也不必重算分组。
  const turnIds = useMemo(() => turns.map((turn) => turn.id), [turns])
  const shellGroups = useMemo(() => groupShellEntries(shellEntries, turnIds), [shellEntries, turnIds])
  const lastTurnId = turnIds.at(-1)
  const knownTurnIds = useRef<Set<string> | null>(null)
  if (knownTurnIds.current === null) knownTurnIds.current = new Set(turns.map((turn) => turn.id))
  // 删除 / 重跑截断的回合先在原位折叠淡出再拿掉。检测放在 useMemo 里按 turns 引用比较：
  // 流式期间每帧都有新 turns，但只有真的少了回合才会产生退场批次；批次 id 不变，清理计时器就不会被每帧重置。
  const previousTurns = useRef(turns)
  const exiting = useRef<{ id: number; turns: ConversationTurn[]; order: string[] } | null>(null)
  const [exitCleared, setExitCleared] = useState(0)
  const renderedTurns = useMemo(() => {
    const previous = previousTurns.current
    if (previous !== turns) {
      const removed = motionEnabled() ? detectRemovedTurns(previous, turns) : []
      if (removed.length) {
        const carried = exiting.current?.turns ?? []
        exiting.current = { id: (exiting.current?.id ?? 0) + 1, turns: [...carried, ...removed], order: previous.map((turn) => turn.id) }
      }
      previousTurns.current = turns
    }
    return mergeExitingTurns(turns, exiting.current?.turns ?? [], exiting.current?.order ?? [])
  // exitCleared 只用来在退场结束后触发一次重算
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, exitCleared])
  const exitBatch = exiting.current?.id ?? null
  useEffect(() => {
    if (exitBatch === null) return
    const timer = window.setTimeout(() => { exiting.current = null; setExitCleared((value) => value + 1) }, MOTION_DURATIONS.expand + 60)
    return () => window.clearTimeout(timer)
  }, [exitBatch])
  const renderShell = (entries: ShellCommandEntry[] | undefined) => entries?.map((entry) =>
    <ShellCommandCard key={entry.id} entry={entry} onCancel={onCancelShellCommand} onDismiss={onDismissShellCommand} />)
  return <div className="conversation-content message-list">
    {renderShell(shellGroups.leading)}
    {renderedTurns.map(({ turn, exiting: leaving }) => {
      const isNew = !knownTurnIds.current!.has(turn.id)
      knownTurnIds.current!.add(turn.id)
      return <React.Fragment key={turn.id}>
        {renderCompaction(compactionMarkers.beforeTurnId[turn.id])}
        {modelChanges.has(turn.id) && <ModelChangeMarker label={models.find((model) => model.id === turn.runtimeConfig.modelId)?.model_name} />}
        <ConversationTurnView isNew={isNew} exiting={leaving} isLast={turn.id === lastTurnId} turn={turn} todos={planDisplayMode === 'inline' ? todosByTurn[turn.id] : undefined} hasMemoryActivity={memoryTurnIds.has(turn.id)} hasContextSources={contextSourceTurnIds.has(turn.id)} modelName={models.find((model) => model.id === turn.runtimeConfig.modelId)?.model_name} onCopy={onCopy} onDelete={onDelete} onRetry={onRetry} onRegenerate={onRegenerate} onEdit={onEdit} onContinue={onContinue} onShowContextMenu={onShowContextMenu} onNotice={onNotice} />
        {renderShell(shellGroups.byTurnId[turn.id])}
      </React.Fragment>
    })}
    {renderCompaction(compactionMarkers.trailing)}
  </div>
})

/** 模型已被删除或下架时拿不到名字，只说明发生过切换，不编造型号。 */
function ModelChangeMarker({ label }: { label?: string }) {
  return <div className="model-change-marker"><span className="model-change-line" />{label ? `已切换到 ${label}` : '已切换模型'}<span className="model-change-line" /></div>
}

const ConversationTurnView = React.memo(function ConversationTurnView({ isNew, exiting = false, isLast, turn, todos, hasMemoryActivity, hasContextSources, modelName, onCopy, onDelete, onRetry, onRegenerate, onEdit, onContinue, onShowContextMenu, onNotice }: { isNew: boolean; exiting?: boolean; isLast: boolean; turn: ConversationTurn; todos?: TodoItem[]; hasMemoryActivity: boolean; hasContextSources: boolean; modelName?: string; onCopy: (text: string) => void; onDelete: (turnId: string) => void; onRetry: (turn: ConversationTurn) => void; onRegenerate: (turn: ConversationTurn) => void; onEdit: (turn: ConversationTurn, text: string, attachments: Attachment[]) => void; onContinue: (turn: ConversationTurn) => void; onShowContextMenu: (event: React.MouseEvent, turn: ConversationTurn) => void; onNotice: (notice: string) => void }) {
  const [editing, setEditing] = useState(false)
  const articleRef = useRef<HTMLElement>(null)
  const contextRef = useRef<HTMLDivElement>(null)
  // 退场：从当前高度收到 0 并淡出，下面的内容跟着平滑上移。停在终态直到列表把它拿掉。
  useLayoutEffect(() => {
    const node = articleRef.current
    if (!exiting || !node) return
    const style = getComputedStyle(node)
    node.animate(
      [{ height: `${node.getBoundingClientRect().height}px`, marginBottom: style.marginBottom, opacity: 1, overflow: 'hidden' },
        { height: '0px', marginBottom: '0px', opacity: 0, overflow: 'hidden' }],
      { duration: MOTION_DURATIONS.expand, easing: MOTION_EASING, fill: 'forwards' }
    )
  }, [exiting])
  const [draft, setDraft] = useState(turn.userMessage.text)
  const [editAttachments, setEditAttachments] = useState<Attachment[]>(turn.attachments)
  const actions = useResponseActions()
  const activity = turn.activity
  const activityStatus = activity?.status === 'working' ? 'working' : activity?.status === 'failed' || activity?.status === 'cancelled' || activity?.status === 'interrupted' ? 'done' : activity?.status === 'done' ? 'done' : 'idle'
  // 任务进度区分失败：ExecutionTrace 把失败归入折叠入口，这里保留原始状态。
  const todoStatus: TodoRunStatus = activity?.status === 'working' ? 'working' : activity?.status === 'failed' || activity?.status === 'cancelled' || activity?.status === 'interrupted' ? 'failed' : 'done'
  // 回车即显示：不等 thinking 事件，chat/agent 都在提交后立即出现计时卡片。
  const showActivity = Boolean(activity && activityStatus !== 'idle')
  // 对话模式没有 Agent 那套动作编排，只思考不调工具时沿用轻量的「分析过程」折叠卡。
  const isChat = turn.runtimeConfig.mode === 'chat'
  // 执行轨迹：从事件流重建动作组与文本段，正文区只渲染从 answerStart 开始的未归档内容。
  // 终态正文区渲染的是最后一条助手消息（transcript 尾部），轨迹文本段必须在此之前收住，否则同一段正文会渲染两次。
  // 夹取长度与 kind 同源取 activity.status：一边夹取一边不渲染正文，回答就看不到；执行中恒为 0，
  // 依赖项不随流式增长变化，轨迹不会逐帧重算。
  const traceKind = activity && activity.status !== 'idle' ? activity.status : 'done'
  const traceAnswerLength = traceFinalAnswerLength(traceKind, turn.assistantMessage?.text.length ?? 0)
  const trace = useMemo(() => buildExecutionTrace(activity?.events ?? [], traceAnswerLength), [activity?.events, traceAnswerLength])
  // chat 调了工具就得看到执行轨迹，否则命令跑了什么完全不可见
  const lightweightActivity = isChat && !hasToolAction(trace)
  // 中断原因来自事件流里最后一条 interrupted 事件；没有事件（历史库）时回退到通用文案。
  const interruption = turn.status === 'interrupted' ? activity?.events.filter((event) => event.type === 'interrupted').at(-1)?.detail || '执行被意外中断' : null
  const shareText = `${turn.userMessage.text}\n\n${turn.assistantMessage?.text || ''}`.trim()
  const renderAssistant = useEventCallback((textStart: number) => <AssistantMessageView turn={turn} modelName={modelName} textStart={textStart} onRegenerate={() => onRegenerate(turn)} onDelete={() => onDelete(turn.id)} onCopyPair={() => onCopy(shareText)} />)
  // 有轨迹时正文里不出操作条：它要排在轨迹底栏（用时 · token · 状态）之下，由本组件在轨迹后面单独渲染。
  const renderTraceAnswer = useEventCallback((textStart: number) => <AssistantMessageView turn={turn} modelName={modelName} textStart={textStart} showActions={false} omitCancelled onRegenerate={() => onRegenerate(turn)} onDelete={() => onDelete(turn.id)} onCopyPair={() => onCopy(shareText)} />)
  const answerText = turn.assistantMessage?.text ?? ''
  const cancelled = cancelledOutcome({ kind: traceKind, answerText, hasWork: hasToolAction(trace), isLast })
  const traceMeta = traceMetaLine({ kind: traceKind, answerText, modelName, createdAt: turn.createdAt })
  const jumpToContext = useEventCallback(() => contextRef.current?.scrollIntoView({ block: 'start', behavior: motionEnabled() ? 'smooth' : 'auto' }))
  // data-turn-id 是对话缩略图量几何的锚点：按回合在滚动内容里的真实位置画条，估算会让点击跳不准。
  return <article ref={articleRef} className={`conversation-turn ${isNew ? 'conversation-turn-new' : ''}${exiting ? ' conversation-turn-exit' : ''}`} data-turn-id={exiting ? undefined : turn.id} aria-hidden={exiting || undefined} tabIndex={0} onContextMenu={(event) => onShowContextMenu(event, turn)}>
    {/* 用户消息不单独占一行时间：气泡在右、时间在左，读起来像是挂在上一条回答底下的；时间看回答头部那一行 */}
    <section className="message user">
      {editing ? <div className="inline-edit">
        {editAttachments.length > 0 && <div className="message-attachments">{editAttachments.map((attachment) => <span className="attachment-chip" key={attachment.id}><Paperclip size={12} />{attachment.name}</span>)}</div>}
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onPaste={(event) => {
          const pasted = attachmentsFromClipboard(event.clipboardData)
          if (pasted.length > 0) setEditAttachments((current) => appendAttachments(current, pasted))
        }} autoFocus />
        <div><button className="text-button" onClick={() => { setDraft(turn.userMessage.text); setEditAttachments(turn.attachments); setEditing(false) }}>取消</button><button className="primary-mini-button" disabled={!draft.trim()} onClick={() => { setEditing(false); onEdit(turn, draft.trim(), editAttachments) }}>发送</button></div>
      </div> : <>
        <div className="message-body">
          {turn.attachments.length > 0 && <div className="message-attachments">{turn.attachments.map((attachment) => isImageAttachment(attachment)
            ? <AttachmentImage key={attachment.id} attachment={attachment} onOpen={actions.openAttachment} />
            : <button type="button" className="attachment-chip" key={attachment.id} title={`预览 ${attachment.name}`} onClick={() => actions.openAttachment(attachment)}><Paperclip size={12} />{attachment.name}</button>)}</div>}
          {normalizeFlagEmoji(turn.userMessage.text)}
        </div>
      </>}
      {!editing && <MessageActions onCopy={() => onCopy(turn.userMessage.text)} onEdit={() => setEditing(true)} onRetry={() => onRetry(turn)} onDelete={() => onDelete(turn.id)} />}
    </section>
    {hasMemoryActivity && <MemoryTurnBar turnId={turn.id} onNotice={onNotice} />}
    {/* 包一层作为吸顶条「本轮上下文」的跳转锚点 */}
    {hasContextSources && <div ref={contextRef} className="turn-context-anchor"><ContextSourceBar turnId={turn.id} onNotice={onNotice} /></div>}
    {interruption && <InterruptionBanner turn={turn} todos={todos} detail={interruption} onContinue={() => onContinue(turn)} />}
    {todos && todos.length > 0 && activity && <TodoPanel items={todos} execution={activity.execution} status={todoStatus} startedAt={Date.parse(activity.startedAt || turn.createdAt)} finishedAt={activity.finishedAt ? Date.parse(activity.finishedAt) : null} />}
    {showActivity && activity && (lightweightActivity
      ? <AgentActivity turnId={turn.id} events={activity.events} thinking={activity.thinking} status={activityStatus} />
      // 操作条并进轨迹收尾行：用时、token 与这几个按钮都是对同一轮的收尾，分成上下两行只会多出一层
      : <ExecutionTraceView turn={turn} trace={trace} startedAt={Date.parse(activity.startedAt || turn.createdAt)} finishedAt={activity.finishedAt ? Date.parse(activity.finishedAt) : null} kind={traceKind} renderAnswer={renderTraceAnswer} meta={traceMeta} onJumpToContext={hasContextSources ? jumpToContext : undefined} outcome={cancelled ? <CancelledNotice outcome={cancelled} onRegenerate={() => onRegenerate(turn)} onContinue={() => onContinue(turn)} /> : undefined} actions={turn.status !== 'working' && turn.assistantMessage
        ? <AssistantMessageActions markdown={turn.assistantMessage.text} plainText={assistantPlainText(turn)} onRegenerate={() => onRegenerate(turn)} onDelete={() => onDelete(turn.id)} onCopyPair={() => onCopy(shareText)} />
        : undefined} />)}
    {lightweightActivity || !showActivity ? <section className="message assistant">
      {/* 没有轨迹的回合（轻量分析卡 / 无活动）由正文区自己承担流式输出，首 token 就要边收边显 */}
      {renderAssistant(0)}
    </section> : null}
    {/* 改动卡片只挂在跑过工具的回合上：没有工具调用就不可能改文件，省掉每轮一次台账查询 */}
    {showActivity && !lightweightActivity && turn.status !== 'working' && <TurnChangesCard turnId={turn.id} onNotice={onNotice} />}
    {(turn.artifacts.length > 0 || turn.citations.length > 0) && <section className="message assistant message-metadata">
      {turn.artifacts.length > 0 && <div className="turn-results">{turn.artifacts.map((artifact, index) => <button className="result-reference" key={artifact.id || index}><span>{artifact.name || artifact.path || 'Result'}</span><span>打开</span></button>)}</div>}
      {turn.citations.length > 0 && <div className="turn-citations">{turn.citations.map((citation, index) => <CitationLink key={citation.id || index} index={index} citation={citation} />)}</div>}
    </section>}
  </article>
})

/** 长任务中断横幅：展示进度与原因，提供继续执行入口。 */
function InterruptionBanner({ turn, todos, detail, onContinue }: { turn: ConversationTurn; todos?: TodoItem[]; detail: string; onContinue: () => void }) {
  const stats = todos && todos.length > 0 ? todoStats(todos) : null
  const progress = stats ? `已完成 ${stats.completed} / ${stats.total} 阶段` : turn.runtimeConfig.mode === 'agent' ? '任务尚未完成' : '回答未完成'
  return <div className="interruption-banner" role="alert">
    {/* 中断可继续，按状态色体系归到「已暂停」：琥珀 + ‖，不用红色告警 */}
    <div className="interruption-head"><Pause size={13} fill="currentColor" strokeWidth={0} /><strong>执行已中断</strong></div>
    <div className="interruption-body"><span>{progress}</span><span>原因：{detail}</span></div>
    <div className="interruption-actions">
      <button className="interruption-continue" onClick={onContinue}><RotateCw size={13} />继续执行</button>
    </div>
  </div>
}

/** 出字前就取消的回合：结果已在过程头上，这里只说还剩什么、能怎么接着来。 */
function CancelledNotice({ outcome, onRegenerate, onContinue }: { outcome: CancelledOutcome; onRegenerate: () => void; onContinue: () => void }) {
  return <div className="trace-outcome">
    <p className="trace-outcome-text">{outcome.hasWork ? '已停止生成，已执行的操作结果保留在上方' : '已停止生成，这一轮还没有回答'}</p>
    <div className="trace-outcome-actions">
      <button type="button" className="trace-outcome-button" onClick={onRegenerate}><RotateCw size={12} />重新生成</button>
      {outcome.canContinue && <button type="button" className="trace-outcome-button" onClick={onContinue}><Play size={12} />继续执行</button>}
    </div>
  </div>
}

/** 用户消息的操作条；助手消息用 ai-response/MessageActions。 */
function MessageActions({ onCopy, onEdit, onRetry, onDelete }: { onCopy: () => void; onEdit: () => void; onRetry: () => void; onDelete: () => void }) {
  // 菜单开关归组件自己：外部点击与 Esc 都要能关，状态放在父组件就接不上 useDismiss。
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLSpanElement>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useDismiss(menuOpen, closeMenu, menuRef)
  const mounted = useDelayedUnmount(menuOpen, MOTION_DURATIONS.popoverClose)
  return <div className="message-actions user">
    <button className="message-action" onClick={onCopy} aria-label="复制" title="复制"><CopyIcon /></button>
    <button className="message-action" onClick={onEdit} aria-label="编辑" title="编辑"><EditIcon /></button>
    <button className="message-action" onClick={onRetry} aria-label="重试" title="重试"><RotateCw size={14} /></button>
    <span className="message-more" ref={menuRef}>
      <button className="message-action" onClick={() => setMenuOpen((value) => !value)} aria-label="更多" title="更多" aria-expanded={menuOpen}><MoreHorizontal size={14} /></button>
      {/* 删除失败时回合还在，菜单必须自己收起来 */}
      {mounted && <div className={`message-menu${menuOpen ? '' : ' closing'}`} role="menu"><button role="menuitem" className="danger-menu-item" onClick={() => { onDelete(); setMenuOpen(false) }}><Trash2 size={14} />删除本轮问答</button></div>}
    </span>
  </div>
}

/** AI 给出的引用链接同样只允许 http/https，交给主进程打开。 */
function CitationLink({ citation, index }: { citation: Citation; index: number }) {
  const actions = useResponseActions()
  const href = sanitizeLinkHref(citation.url)
  const label = `[${index + 1}] ${citation.title || citation.url || '引用'}`
  if (!href) return <span className="citation-blocked">{label}</span>
  return <a href={href} onClick={(event) => { event.preventDefault(); void openExternalLink(href, actions.notify) }}>{label}</a>
}

function CopyIcon() { return <Copy size={14} /> }
function EditIcon() { return <Edit3 size={14} /> }

/**
 * 对话模式的思考区：只有一行状态，展开后列工具执行记录。
 * 复杂的阶段编排与执行轨迹留给 Agent 模式，这里以占用纵向空间最小为准。
 */
function AgentActivity({ turnId, events, thinking, status }: { turnId: string; events: AgentEvent[]; thinking: string | undefined; status: 'idle' | 'working' | 'done' }) {
  // 默认折叠：正文才是用户要看的，思考过程一律等用户点开，免得流式输出期间把正文推离视线。
  const [expanded, setExpanded] = useState(false)
  const toolGroups = useMemo(() => groupToolCallEvents(events), [events])
  const thinkingText = thinking?.trim() || ''
  // 思考正文由 thinkingBuffer 实时补、终态再由主进程覆盖；两者都没有时展开是空的，不给假入口。
  const collapsible = toolGroups.length > 0 || Boolean(thinkingText)
  // 回合已终态时，没等到 tool_result 的工具卡再也不会被更新，必须按终态收敛，否则永远转圈。
  const terminalEvent = events.find((event) => event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled' || event.type === 'interrupted')
  const unresolvedToolStatus = terminalEvent ? terminalEvent.type === 'completed' ? 'done' : 'failed' : null
  let thinkingActive = false
  let thinkingLifecycleEnded = false
  for (const event of events) {
    if (event.type === 'thinking_started') { thinkingActive = true; thinkingLifecycleEnded = false }
    if (event.type === 'thinking_ended') { thinkingActive = false; thinkingLifecycleEnded = true }
  }
  // 快速 Chat 没有 thinking_started/ended，运行态本身就是思考阶段；Agent 模式按最后一个生命周期事件判断。
  const thinkingRunning = status === 'working' && (thinkingActive || !thinkingLifecycleEnded)
  const label = thinkingRunning ? 'Thinking' : 'Thinked'
  const summary = <>
    <span className={thinkingRunning ? 'activity-pulse' : 'activity-pulse static'} />
    <span>{label}</span>
    {collapsible && <ChevronRight size={13} className="activity-chevron" />}
  </>
  return <section className={`agent-activity ${status} ${expanded ? 'expanded' : 'collapsed'}`}>
    {collapsible
      ? <button className="activity-heading" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} title={expanded ? '收起' : '展开'}>{summary}</button>
      : <div className="activity-heading static">{summary}</div>}
    <Collapse open={expanded && collapsible} appear={false}><div className="activity-details">
      {thinkingText && <ThinkingText id={`${turnId}-thinking`} text={thinkingText} className="activity-thinking" />}
      {toolGroups.map((group) => <ToolCallCard
        key={group.toolCallId}
        turnId={turnId}
        group={group}
        summary={unresolvedToolStatus && !group.events.some((event) => event.type === 'tool_result') ? { status: unresolvedToolStatus } : undefined}
      />)}
    </div></Collapse>
  </section>
}

export function EmptyConversation({ onPickWorkspace, onAddAttachment, onRunAgent }: { onPickWorkspace: () => void; onAddAttachment: () => void; onRunAgent?: () => void }) {
  return <div className="empty-conversation motion-welcome-enter"><div className="empty-mark" aria-hidden="true"><span className="empty-mark-glyph"><Zap size={22} fill="currentColor" strokeWidth={0} /></span></div><h1>今天想做什么？</h1><div className="quick-actions"><button onClick={onPickWorkspace}><FolderOpen size={16} /> 打开项目</button><button onClick={onAddAttachment}><Archive size={16} /> 添加附件</button>{onRunAgent && <button onClick={onRunAgent}><TerminalSquare size={16} /> 运行智能体</button>}</div></div>
}
