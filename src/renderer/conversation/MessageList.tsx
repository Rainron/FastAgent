import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Archive, ChevronRight, Copy, Edit3, FolderOpen, MoreHorizontal, Paperclip, Pause, RotateCw, TerminalSquare, Trash2 } from 'lucide-react'
import type { AgentEvent, Attachment, Citation, ConversationTurn, ModelOption, TodoItem } from '../../shared/types'
import { groupToolCallEvents } from '../activity'
import { AssistantMessageView } from '../ai-response/AssistantMessage'
import { normalizeFlagEmoji } from '../ai-response/flag-emoji'
import { openExternalLink, useResponseActions } from '../ai-response/response-context'
import { sanitizeLinkHref } from '../ai-response/sanitize-url'
import { appendAttachments, attachmentsFromClipboard } from '../composer/attachments'
import { buildExecutionTrace } from '../execution-trace'
import { useDismiss } from '../use-dismiss'
import { ExecutionTraceView } from './ExecutionTrace'
import { modelChangeTurnIds } from './model-change-marker'
import { TodoPanel, type TodoRunStatus } from './TodoPanel'
import { ThinkingText } from './ThinkingText'
import { todoStats } from './todo-status'
import { ToolCallCard } from './ToolCallCard'

export const MessageList = React.memo(function MessageList({ turns, models, todosByTurn, onCopy, onDelete, onRetry, onRegenerate, onEdit, onContinue, onShowContextMenu }: { turns: ConversationTurn[]; models: ModelOption[]; todosByTurn: Record<string, TodoItem[]>; onCopy: (text: string) => void; onDelete: (turnId: string) => void; onRetry: (turn: ConversationTurn) => void; onRegenerate: (turn: ConversationTurn) => void; onEdit: (turn: ConversationTurn, text: string, attachments: Attachment[]) => void; onContinue: (turn: ConversationTurn) => void; onShowContextMenu: (event: React.MouseEvent, turn: ConversationTurn) => void }) {
  const modelChanges = useMemo(() => modelChangeTurnIds(turns), [turns])
  const knownTurnIds = useRef<Set<string> | null>(null)
  if (knownTurnIds.current === null) knownTurnIds.current = new Set(turns.map((turn) => turn.id))
  return <div className="conversation-content message-list">{turns.map((turn) => {
    const isNew = !knownTurnIds.current!.has(turn.id)
    knownTurnIds.current!.add(turn.id)
    return <React.Fragment key={turn.id}>
      {modelChanges.has(turn.id) && <ModelChangeMarker label={models.find((model) => model.id === turn.runtimeConfig.modelId)?.model_name} />}
      <ConversationTurnView isNew={isNew} turn={turn} todos={todosByTurn[turn.id]} onCopy={onCopy} onDelete={onDelete} onRetry={onRetry} onRegenerate={onRegenerate} onEdit={onEdit} onContinue={onContinue} onShowContextMenu={onShowContextMenu} />
    </React.Fragment>
  })}</div>
})

/** 模型已被删除或下架时拿不到名字，只说明发生过切换，不编造型号。 */
function ModelChangeMarker({ label }: { label?: string }) {
  return <div className="model-change-marker"><span className="model-change-line" />{label ? `已切换到 ${label}` : '已切换模型'}<span className="model-change-line" /></div>
}

const ConversationTurnView = React.memo(function ConversationTurnView({ isNew, turn, todos, onCopy, onDelete, onRetry, onRegenerate, onEdit, onContinue, onShowContextMenu }: { isNew: boolean; turn: ConversationTurn; todos?: TodoItem[]; onCopy: (text: string) => void; onDelete: (turnId: string) => void; onRetry: (turn: ConversationTurn) => void; onRegenerate: (turn: ConversationTurn) => void; onEdit: (turn: ConversationTurn, text: string, attachments: Attachment[]) => void; onContinue: (turn: ConversationTurn) => void; onShowContextMenu: (event: React.MouseEvent, turn: ConversationTurn) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(turn.userMessage.text)
  const [editAttachments, setEditAttachments] = useState<Attachment[]>(turn.attachments)
  const activity = turn.activity
  const activityStatus = activity?.status === 'working' ? 'working' : activity?.status === 'failed' || activity?.status === 'cancelled' || activity?.status === 'interrupted' ? 'done' : activity?.status === 'done' ? 'done' : 'idle'
  // 任务进度区分失败：ExecutionTrace 把失败归入折叠入口，这里保留原始状态。
  const todoStatus: TodoRunStatus = activity?.status === 'working' ? 'working' : activity?.status === 'failed' || activity?.status === 'cancelled' || activity?.status === 'interrupted' ? 'failed' : 'done'
  // 回车即显示：不等 thinking 事件，chat/agent 都在提交后立即出现计时卡片。
  const showActivity = Boolean(activity && activityStatus !== 'idle')
  // 对话模式没有 Agent 那套动作编排，沿用轻量的「分析过程」折叠卡；执行轨迹只给 Agent 模式。
  const isChat = turn.runtimeConfig.mode === 'chat'
  // 执行轨迹：从事件流重建动作组与文本段，正文区只渲染从 answerStart 开始的未归档内容。
  const trace = useMemo(() => buildExecutionTrace(activity?.events ?? []), [activity?.events])
  // 中断原因来自事件流里最后一条 interrupted 事件；没有事件（历史库）时回退到通用文案。
  const interruption = turn.status === 'interrupted' ? activity?.events.filter((event) => event.type === 'interrupted').at(-1)?.detail || '执行被意外中断' : null
  const shareText = `${turn.userMessage.text}\n\n${turn.assistantMessage?.text || ''}`.trim()
  return <article className={`conversation-turn ${isNew ? 'conversation-turn-new' : ''}`} tabIndex={0} onContextMenu={(event) => onShowContextMenu(event, turn)}>
    <section className="message user">
      {!editing && turn.attachments.length > 0 && <div className="message-attachments">{turn.attachments.map((attachment) => <span className="attachment-chip" key={attachment.id}><Paperclip size={12} />{attachment.name}</span>)}</div>}
      {editing ? <div className="inline-edit">
        {editAttachments.length > 0 && <div className="message-attachments">{editAttachments.map((attachment) => <span className="attachment-chip" key={attachment.id}><Paperclip size={12} />{attachment.name}</span>)}</div>}
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onPaste={(event) => {
          const pasted = attachmentsFromClipboard(event.clipboardData)
          if (pasted.length > 0) setEditAttachments((current) => appendAttachments(current, pasted))
        }} autoFocus />
        <div><button className="text-button" onClick={() => { setDraft(turn.userMessage.text); setEditAttachments(turn.attachments); setEditing(false) }}>取消</button><button className="primary-mini-button" disabled={!draft.trim()} onClick={() => { setEditing(false); onEdit(turn, draft.trim(), editAttachments) }}>发送</button></div>
      </div> : <div className="message-body">{normalizeFlagEmoji(turn.userMessage.text)}</div>}
      {!editing && <MessageActions onCopy={() => onCopy(turn.userMessage.text)} onEdit={() => setEditing(true)} onRetry={() => onRetry(turn)} onDelete={() => onDelete(turn.id)} />}
    </section>
    {interruption && <InterruptionBanner turn={turn} todos={todos} detail={interruption} onContinue={() => onContinue(turn)} />}
    {todos && todos.length > 0 && activity && <TodoPanel items={todos} execution={activity.execution} status={todoStatus} startedAt={Date.parse(activity.startedAt || turn.createdAt)} finishedAt={activity.finishedAt ? Date.parse(activity.finishedAt) : null} />}
    {showActivity && activity && (isChat
      ? <AgentActivity turnId={turn.id} events={activity.events} thinking={activity.thinking} status={activityStatus} />
      : <ExecutionTraceView turn={turn} trace={trace} startedAt={Date.parse(activity.startedAt || turn.createdAt)} finishedAt={activity.finishedAt ? Date.parse(activity.finishedAt) : null} kind={activity.status !== 'idle' ? activity.status : 'done'} />)}
    <section className="message assistant">
      {/* 对话模式不切分正文：没有执行轨迹承接前段说明，正文区必须拿到完整回答。 */}
      <AssistantMessageView turn={turn} textStart={isChat || turn.status !== 'working' ? 0 : trace.answerStart} onRegenerate={() => onRegenerate(turn)} onDelete={() => onDelete(turn.id)} onCopyPair={() => onCopy(shareText)} />
      {turn.artifacts.length > 0 && <div className="turn-results">{turn.artifacts.map((artifact, index) => <button className="result-reference" key={artifact.id || index}><span>{artifact.name || artifact.path || 'Result'}</span><span>打开</span></button>)}</div>}
      {turn.citations.length > 0 && <div className="turn-citations">{turn.citations.map((citation, index) => <CitationLink key={citation.id || index} index={index} citation={citation} />)}</div>}
    </section>
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

/** 用户消息的操作条；助手消息用 ai-response/MessageActions。 */
function MessageActions({ onCopy, onEdit, onRetry, onDelete }: { onCopy: () => void; onEdit: () => void; onRetry: () => void; onDelete: () => void }) {
  // 菜单开关归组件自己：外部点击与 Esc 都要能关，状态放在父组件就接不上 useDismiss。
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLSpanElement>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useDismiss(menuOpen, closeMenu, menuRef)
  return <div className="message-actions user">
    <button className="message-action" onClick={onCopy} aria-label="复制" title="复制"><CopyIcon /></button>
    <button className="message-action" onClick={onEdit} aria-label="编辑" title="编辑"><EditIcon /></button>
    <button className="message-action" onClick={onRetry} aria-label="重试" title="重试"><RotateCw size={14} /></button>
    <span className="message-more" ref={menuRef}>
      <button className="message-action" onClick={() => setMenuOpen((value) => !value)} aria-label="更多" title="更多" aria-expanded={menuOpen}><MoreHorizontal size={14} /></button>
      {/* 删除失败时回合还在，菜单必须自己收起来 */}
      {menuOpen && <div className="message-menu" role="menu"><button role="menuitem" className="danger-menu-item" onClick={() => { onDelete(); setMenuOpen(false) }}><Trash2 size={14} />删除本轮问答</button></div>}
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
    {expanded && collapsible && <div className="activity-details">
      {thinkingText && <ThinkingText id={`${turnId}-thinking`} text={thinkingText} className="activity-thinking" />}
      {toolGroups.map((group) => <ToolCallCard
        key={group.toolCallId}
        turnId={turnId}
        group={group}
        summary={unresolvedToolStatus && !group.events.some((event) => event.type === 'tool_result') ? { status: unresolvedToolStatus } : undefined}
      />)}
    </div>}
  </section>
}

export function EmptyConversation({ onPickWorkspace, onAddAttachment, onRunAgent }: { onPickWorkspace: () => void; onAddAttachment: () => void; onRunAgent?: () => void }) {
  return <div className="empty-conversation motion-welcome-enter"><div className="empty-kicker"><span className="kicker-line" /> 准备开始 <span className="kicker-line" /></div><h1>今天想做什么？</h1><p>从一个问题开始，或打开一个项目让 FastAgent 参与工作。</p><div className="quick-actions"><button onClick={onPickWorkspace}><FolderOpen size={16} /> 打开项目</button><button onClick={onAddAttachment}><Archive size={16} /> 添加附件</button>{onRunAgent && <button onClick={onRunAgent}><TerminalSquare size={16} /> 运行智能体</button>}</div></div>
}
