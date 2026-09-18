import { useEffect } from 'react'
import type React from 'react'
import type { ConversationRunState, ConversationTurn, TodoItem } from '../../shared/types'
import { nextActivityRunStatus, resolveEventTurnId } from '../activity'
import type { StreamBuffer } from '../ai-response/stream-buffer'
import { completeCompaction, type CompactionStates } from '../conversation/compaction-state'
import type { ContextHealthData } from '../conversation/ContextHealth'
import type { PendingApproval, WorkspaceConversation } from './workspace-types'

export interface AgentEventSinks {
  selectedConversationId: string | null
  streamBuffer: StreamBuffer
  /** 思考正文的独立缓冲：与回答正文分开累积，冲刷频率也更低。 */
  thinkingBuffer: StreamBuffer
  refreshGitState: () => void
  /** 事件回调里查 turn 归属的会话，避免订阅随列表变化反复重建。 */
  conversationItemsRef: React.RefObject<WorkspaceConversation[]>
  runTurnRef: React.RefObject<Map<string, string>>
  activeTurnRef: React.RefObject<string | null>
  streamedTextRef: React.RefObject<Map<string, string>>
  eventSequenceRef: React.RefObject<Map<string, number>>
  setRunStates: React.Dispatch<React.SetStateAction<Record<string, ConversationRunState>>>
  setCompactionStates: React.Dispatch<React.SetStateAction<CompactionStates>>
  setContextHealth: React.Dispatch<React.SetStateAction<ContextHealthData>>
  setApprovals: React.Dispatch<React.SetStateAction<PendingApproval[]>>
  setTodosByTurn: React.Dispatch<React.SetStateAction<Record<string, TodoItem[]>>>
  setTurns: React.Dispatch<React.SetStateAction<ConversationTurn[]>>
  setRunIdsByConversation: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setNotice: (notice: string) => void
}

/** 主进程 agent 事件流的唯一订阅点：把事件分派到运行状态、上下文、审批、待办与回合活动。 */
export function useAgentEvents(sinks: AgentEventSinks) {
  const {
    selectedConversationId, streamBuffer, thinkingBuffer, refreshGitState,
    conversationItemsRef, runTurnRef, activeTurnRef, streamedTextRef, eventSequenceRef,
    setRunStates, setCompactionStates, setContextHealth, setApprovals, setTodosByTurn, setTurns, setRunIdsByConversation, setNotice
  } = sinks

  useEffect(() => window.fastAgent.chat.onEvent((event) => {
    const previousSequence = eventSequenceRef.current.get(event.runId) ?? 0
    if (event.sequence !== undefined && event.sequence <= previousSequence) return
    if (event.sequence !== undefined) eventSequenceRef.current.set(event.runId, event.sequence)
    // Agent 任何工具执行结束都可能改变工作区文件或分支，统一触发 Git 状态刷新（防抖合并）。
    if (event.type === 'tool_result') refreshGitState()
    if (event.conversationId && (event.type === 'run_started' || event.type === 'approval_required' || event.type === 'approval_resolved' || event.type === 'question_required' || event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled' || event.type === 'interrupted')) {
      const status = event.type === 'approval_required' || event.type === 'question_required' ? 'waiting_user' : event.type === 'completed' ? 'completed' : event.type === 'failed' ? 'failed' : event.type === 'cancelled' || event.type === 'interrupted' ? 'cancelled' : 'running'
      setRunStates((current) => ({ ...current, [event.conversationId!]: { conversationId: event.conversationId!, projectId: conversationItemsRef.current.find((item) => item.id === event.conversationId)?.projectId ?? current[event.conversationId!]?.projectId ?? null, status, hasUnreadResult: status === 'completed' || status === 'failed' || status === 'cancelled', updatedAt: Date.now() } }))
      if (event.conversationId === selectedConversationId && event.type === 'run_started') setContextHealth((current) => ({ ...current, usagePending: true }))
      if (event.conversationId === selectedConversationId && (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled' || event.type === 'interrupted')) setContextHealth((current) => ({ ...current, usagePending: false }))
    }
    if (event.phase === 'compacting' && event.conversationId) {
      setCompactionStates((current) => {
        const state = current[event.conversationId!]
        if (!state || state.status !== 'running') return current
        if (event.type === 'compactionCompleted' || event.status === 'completed') return completeCompaction(current, event.conversationId!)
        return { ...current, [event.conversationId!]: { ...state, progress: event.progress ?? state.progress, phase: event.detail || state.phase } }
      })
    }
    if (event.type === 'contextUpdated' || event.type === 'compactionCompleted') {
      if (event.conversationId !== selectedConversationId) return
      // contextUpdated 不带压缩记录，最近压缩时间沿用旧值而不是清空。
      if (event.context) setContextHealth((current) => ({ ...event.context!, latestCompactionAt: event.compaction?.createdAt ?? current.latestCompactionAt ?? null, usage: current.usage, usagePending: current.usagePending }))
      if (event.type === 'compactionCompleted' && event.context) {
        const before = Math.round((event.compaction?.beforeTokens || 0) / event.context.contextWindow * 100)
        const after = Math.round((event.compaction?.afterTokens || 0) / event.context.contextWindow * 100)
        setNotice(`${event.compaction?.triggerReason.startsWith('pi-') ? '已压缩长任务上下文' : '已压缩旧上下文'} · ${before}% → ${after}%`)
      }
      return
    }
    if (event.type === 'usageUpdated' && event.conversationId === selectedConversationId && event.usage) {
      setContextHealth((current) => ({ ...current, usage: event.usage, usagePending: false }))
    }
    if ((event.type === 'failed' || event.type === 'tool_result') && event.status === 'failed') {
      const detail = event.detail?.trim() || '未知错误'
      if (event.type === 'tool_result' && event.tool?.startsWith('mcp__')) {
        setNotice(`MCP 调用失败：${event.tool} · ${detail}`)
      } else if (event.type === 'failed') {
        setNotice(`模型运行失败：${detail}`)
      }
    }
    if ((event.type === 'approval_required' || event.type === 'question_required') && event.approval) {
      setApprovals((current) => current.some((item) => item.request.id === event.approval?.id)
        ? current
        : [...current, { request: event.approval!, runId: event.runId, conversationId: event.conversationId ?? null }])
    }
    if (event.type === 'approval_resolved' && event.approval) {
      setApprovals((current) => current.filter((item) => item.runId !== event.runId || item.request.id !== event.approval!.id))
    }
    if (event.type === 'todo_changed' && event.todos) {
      const turnId = resolveEventTurnId(event, runTurnRef.current.get(event.runId), activeTurnRef.current)
      // 任务进度归属当前回合而不是页面：没有可归属的回合就不展示。
      if (turnId) setTodosByTurn((current) => ({ ...current, [turnId]: event.todos! }))
    }
    const turnId = resolveEventTurnId(event, runTurnRef.current.get(event.runId), activeTurnRef.current)
    if (!turnId) return
    // token 走缓冲区；thinking 文本走另一条低频缓冲，执行中也能展开看，终态再由主进程的全文覆盖。
    // thinking 起止不带文本，主进程也会落库；这里同样记进 activity，
    // 否则实时轨迹没有 Thinking，切走再切回按库回放却有，两边对不上。
    // 思考起止是分段边界：先把积压冲干净，否则上一轮的尾巴会被记进下一段。
    if (event.type === 'thinking_started' || event.type === 'thinking_ended') thinkingBuffer.flush()
    if (event.type === 'thinking_started') streamBuffer.markThinking(turnId)
    if (event.type === 'thinking_ended') streamBuffer.markThinkingEnded(turnId)
    if (event.type === 'token' || event.type === 'thinking') {
      if (event.type === 'token' && event.text) streamBuffer.push(turnId, event.text)
      if (event.type === 'thinking' && event.text) thinkingBuffer.push(turnId, event.text)
      return
    }
    // 结束事件要用完整文本收尾，先把积压冲掉，避免顺序错乱。
    // 思考缓冲同样要先落地：晚一步冲刷会接在主进程回传的全文后面，变成重复的一段。
    if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled' || event.type === 'interrupted') { streamBuffer.flush(); thinkingBuffer.flush() }
    setTurns((current) => current.map((turn) => {
      if (turn.id !== turnId) return turn
      const nextEvents = [...(turn.activity?.events || []), event]
      const terminalEvent = event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled' || event.type === 'interrupted'
      const priorRunStatus = turn.activity?.status === 'done' || turn.activity?.status === 'failed' || turn.activity?.status === 'cancelled' || turn.activity?.status === 'interrupted' ? 'done' : 'working'
      const nextRunStatus = nextActivityRunStatus(priorRunStatus, event.type)
      const activityStatus = terminalEvent ? event.type === 'failed' ? 'failed' : event.type === 'cancelled' ? 'cancelled' : event.type === 'interrupted' ? 'interrupted' : 'done' : nextRunStatus === 'done' ? turn.activity?.status || 'done' : 'working'
      // 执行中的思考正文由 thinkingBuffer 累积，终态事件带回主进程全文后直接覆盖，两者内容一致
      // thinking_started 在这里开新的一段，thinkingBuffer 之后冲刷的文本都落进这一段。
      const priorSegments = turn.activity?.thinkingSegments
      const thinkingSegments = event.thinkingSegments ?? (event.type === 'thinking_started' ? [...(priorSegments ?? []), ''] : priorSegments)
      const activity = { status: activityStatus, startedAt: turn.activity?.startedAt || turn.createdAt, finishedAt: terminalEvent ? new Date().toISOString() : turn.activity?.finishedAt || null, events: nextEvents, thinking: event.thinkingText || turn.activity?.thinking, thinkingSegments, transcript: event.transcriptText || turn.activity?.transcript, execution: event.execution || turn.activity?.execution } as const
      let assistantMessage = turn.assistantMessage
      if ((event.type === 'completed' || event.type === 'interrupted') && event.text) assistantMessage = { text: event.text, createdAt: assistantMessage?.createdAt || new Date().toISOString() }
      const status = terminalEvent ? event.type === 'failed' ? 'failed' : event.type === 'cancelled' ? 'cancelled' : event.type === 'interrupted' ? 'interrupted' : 'completed' : turn.status !== 'working' ? turn.status : 'working'
      return { ...turn, activity, assistantMessage, status, updatedAt: new Date().toISOString() }
    }))
    if (event.type === 'failed' || event.type === 'completed' || event.type === 'cancelled' || event.type === 'interrupted') {
      // 终态后主进程已把完整文本落库，内存缓存可以释放，避免长会话里无限增长。
      streamedTextRef.current.delete(turnId)
      setRunIdsByConversation((current) => {
        if (!event.conversationId || current[event.conversationId] !== event.runId) return current
        const next = { ...current }
        delete next[event.conversationId]
        return next
      })
      // 回合结束，只清掉本 run 尚未处理的挂起审批（主进程侧已按拒绝结算），其他会话的照旧保留。
      setApprovals((current) => current.filter((item) => item.runId !== event.runId))
    }
  }), [selectedConversationId, streamBuffer, thinkingBuffer, refreshGitState, conversationItemsRef, runTurnRef, activeTurnRef, streamedTextRef, eventSequenceRef, setRunStates, setCompactionStates, setContextHealth, setApprovals, setTodosByTurn, setTurns, setRunIdsByConversation, setNotice])
}
