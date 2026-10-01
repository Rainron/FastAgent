import type { ThinkingLevel } from '../../shared/types'
import type { AgentEvent } from '../../shared/types'
import { createExecutionState, reduceExecutionState } from '../agent/execution-state'
import { classifyRunError } from '../agent/run-error'
import { resolveContextWindow } from '../../shared/model-context-windows'
import { projectRunState, resolveTurnWrite } from '../agent/run-state'
import type { ContextMeasurement } from '../context-meter'
import { breadcrumb } from '../logging/logger'
import { normalizeModelUsage } from '../model-usage'
import { sendQuickWindowEvent } from '../quick-window'
import { executionInputForEvent } from '../run/execution-input'
import { createTokenEventBatcher } from '../token-event-batcher'
import { persistableEvent } from '../turn-activity'
import type { RunContext } from './context'

const QUICK_HISTORY_TURNS = 20

/**
 * 快速对话执行体：直接调模型接口（runDirectChat），不创建 pi 运行时，
 * 无工具 / MCP / 沙箱 / 权限审批，上下文来自持久会话的最近若干回合。
 */
export async function runQuickChat(ctx: RunContext, runId: string, turnId: string, conversationId: string, namespace: string, prompt: string, modelId: number | null, thinkingLevel: ThinkingLevel, signal: AbortSignal, acceptedAt = Date.now()) {
  let streamedText = ''
  let thinkingText = ''
  // 与 Agent 路径一致地按思考轮次切分，折叠层展开时每一轮各自成段。
  const thinkingSegments: string[] = []
  let sequence = 0
  let execution = createExecutionState(runId, [])
  let quickContextMeasurement: ContextMeasurement | undefined
  const sendEvent = (event: AgentEvent) => {
    ctx.mainWindow?.webContents.send('chat:event', event)
    sendQuickWindowEvent('chat:event', event)
  }
  const eventBatcher = createTokenEventBatcher(sendEvent, 16)
  // 快速对话无工具无压缩，落库只写事件与终态文本；token 不落库（与运行时路径一致）。
  const emit = (event: Omit<AgentEvent, 'runId'>) => {
    const timestamp = Date.now()
    if (event.type === 'thinking_started') thinkingSegments.push('')
    if (event.type === 'thinking' && event.text) {
      if (!thinkingSegments.length) thinkingSegments.push('')
      thinkingSegments[thinkingSegments.length - 1] += event.text
    }
    if (event.type === 'usageUpdated' && event.usageRecord) {
      ctx.store.recordModelUsage(namespace, event.usageRecord)
      event.usage = ctx.store.getModelUsage(namespace, conversationId, turnId)
    }
    const projection = projectRunState(event.type)
    if (projection.runStatus) ctx.store.saveRunState(namespace, { conversationId, projectId: ctx.store.getConversation(namespace, conversationId)?.projectId ?? null, status: projection.runStatus, hasUnreadResult: projection.hasUnreadResult, updatedAt: timestamp })
    const executionInput = executionInputForEvent(event, timestamp, execution)
    if (executionInput) {
      execution = reduceExecutionState(execution, executionInput)
      event.eventId = executionInput.eventId
      event.stepId = executionInput.stepId
      event.thinkingId = executionInput.thinkingId
    }
    const fullEvent: AgentEvent = { runId, conversationId, turnId, timestamp, sequence: ++sequence, elapsedMs: timestamp - acceptedAt, textLength: streamedText.length, ...event, execution }
    if (streamedText && projection.terminal && projection.terminal !== 'cancelled') fullEvent.transcriptText = streamedText
    if (thinkingText && projection.terminal) fullEvent.thinkingText = thinkingText
    if (thinkingSegments.length && projection.terminal) fullEvent.thinkingSegments = [...thinkingSegments]
    if (event.type === 'token' || event.type === 'thinking') { eventBatcher.emit(fullEvent); return }
    // 快速对话同样结算台账：不写的话进程被 kill 后这些 run 永远停在 running，
    // markInterruptedAgentRuns 也看不到它们。
    if (projection.ledgerStatus) ctx.store.finishAgentRun(namespace, runId, projection.ledgerStatus, event.detail ?? null, timestamp, event.errorKind ?? null)
    const turn = ctx.store.getTurn(namespace, turnId)
    if (turn) {
      const activity = turn.activity ?? { status: 'working' as const, startedAt: turn.createdAt, finishedAt: null, events: [] }
      const write = resolveTurnWrite(projection, { turnStatus: turn.status, activityStatus: activity.status })
      const finalText = projection.terminal ? (fullEvent.text || '') : ''
      ctx.store.updateTurn(namespace, turnId, {
        // 事件副本不带 execution：顶层已存一份最新快照，逐条再存一份会让 activity 体积随事件数平方增长。
        activity: { ...activity, status: write.activityStatus, finishedAt: projection.terminal ? new Date().toISOString() : activity.finishedAt, events: [...activity.events, persistableEvent(fullEvent)], thinking: thinkingText || activity.thinking, thinkingSegments: thinkingSegments.length ? [...thinkingSegments] : activity.thinkingSegments, transcript: fullEvent.transcriptText || activity.transcript, execution },
        status: write.turnStatus,
        assistantMessage: finalText ? { text: finalText, createdAt: new Date().toISOString() } : undefined
      }, turn)
    }
    eventBatcher.emit(fullEvent)
  }
  ctx.store.startAgentRun(namespace, { runId, conversationId, turnId, mode: 'chat', startedAt: acceptedAt })
  emit({ type: 'run_started', phase: 'queued', detail: '请求已接收', status: 'running' })
  try {
    if (!modelId) throw new Error('未选择可用模型')
    if (signal.aborted) throw new DOMException('已取消', 'AbortError')
    const credentials = ctx.resolveModelCredentials(modelId)
    // 只取已完成的回合拼上下文：当前 turn 刚建只有用户消息，过滤掉；无回复的失败回合跳过。
    const priorTurns = ctx.store.listTurns(namespace, conversationId)
      .filter((turn) => turn.id !== turnId)
      .slice(-QUICK_HISTORY_TURNS)
    const history = priorTurns.flatMap((turn) => turn.assistantMessage
      ? [{ role: 'user' as const, text: turn.userMessage.text }, { role: 'assistant' as const, text: turn.assistantMessage.text }]
      : [{ role: 'user' as const, text: turn.userMessage.text }])
    emit({ type: 'run_phase', phase: 'initializing', detail: '正在连接模型', status: 'running' })
    const { runDirectChat, classifyRunOutcome } = await ctx.loadPiRuntime()
    const result = await runDirectChat({
      prompt,
      credentials,
      thinkingLevel,
      history,
      signal,
      createModelRuntime: ctx.createModelRuntimeForCredentials,
      onToken: (text) => { streamedText += text; emit({ type: 'token', text }) },
      onThinking: (text) => { thinkingText += text; emit({ type: 'thinking', text }) }
    })
    const usageRecord = result.usage
      ? normalizeModelUsage(
          { role: 'assistant', usage: result.usage, stopReason: result.stopReason, timestamp: Date.now() },
          { conversationId, turnId, runId, modelId, provider: credentials.provider, modelName: credentials.model_name, baseUrl: credentials.base_url },
          `${runId}:direct`
        )
      : null
    if (usageRecord) emit({ type: 'usageUpdated', usageRecord: { ...usageRecord, status: result.stopReason === 'error' ? 'failed' : result.stopReason === 'aborted' ? 'cancelled' : 'completed' } })
    quickContextMeasurement = ctx.contextMeter.measure({
      modelId,
      provider: credentials.provider,
      contextWindow: resolveContextWindow(credentials.context_window, credentials.model_name),
      turns: [...priorTurns.map((turn) => ({ user: turn.userMessage.text, assistant: turn.assistantMessage?.text })), { user: prompt, assistant: result.text }],
      usage: result.usageTokens === null ? undefined : { inputTokens: result.usageTokens }
    })
    if (result.stopReason === 'length') {
      const outcome = classifyRunOutcome({ content: [{ type: 'text', text: result.text }], stopReason: result.stopReason, usage: result.usage }, { contextWindow: resolveContextWindow(credentials.context_window, credentials.model_name), maxTokens: credentials.max_tokens || 8_192 })
      emit({ type: 'interrupted', text: result.text, detail: outcome.reason, status: 'interrupted' })
    } else emit({ type: 'completed', text: result.text, detail: '回答完成', status: 'completed' })
  } catch (error) {
    const classified = classifyRunError(error)
    if (classified.kind === 'cancelled') emit({ type: 'cancelled', detail: '已取消' })
    else {
      ctx.reportModelFailure(modelId, error, Date.now() - acceptedAt)
      emit({ type: 'failed', detail: classified.message, status: 'failed', errorKind: classified.kind })
    }
  } finally {
    breadcrumb('run', `quick-finish ${runId}`)
    ctx.activeRuns.delete(runId)
    emit({ type: 'contextUpdated', context: ctx.refreshContext(namespace, conversationId, undefined, modelId, quickContextMeasurement) })
    eventBatcher.dispose()
    console.info('[run-timing]', { runId, conversationId, turnId, phase: 'quick-completed', elapsedMs: Date.now() - acceptedAt })
  }
}
