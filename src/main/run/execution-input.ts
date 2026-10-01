import type { AgentEvent } from '../../shared/types'
import type { createExecutionState, ExecutionInput } from '../agent/execution-state'

/** 把一条 agent 事件映射成执行轨迹输入；映射不到轨迹的事件返回 null。 */
export function executionInputForEvent(event: Omit<AgentEvent, 'runId'>, timestamp: number, current: ReturnType<typeof createExecutionState>): ExecutionInput | null {
  const terminalType = event.type === 'completed' ? 'run_completed' : event.type === 'failed' ? 'run_failed' : event.type === 'cancelled' || event.type === 'interrupted' ? 'run_cancelled' : null
  if (terminalType) return { type: terminalType, timestamp }
  if (event.type === 'token' && current.activeThinkingId) return { type: 'assistant_content_started', eventId: `${current.runId}:assistant-content:${timestamp}`, stepId: current.activeStepId ?? undefined, thinkingId: current.activeThinkingId, timestamp }
  if (event.type === 'thinking_started' || event.type === 'thinking_ended' || event.type === 'tool_started' || event.type === 'tool_result') return { type: event.type, eventId: event.eventId ?? (event.toolCallId ? `tool:${event.toolCallId}` : event.type === 'thinking_started' ? `${current.runId}:thinking:${timestamp}` : event.type === 'thinking_ended' ? current.activeThinkingId ?? undefined : undefined), stepId: event.stepId ?? current.activeStepId ?? undefined, toolCallId: event.toolCallId, thinkingId: event.thinkingId ?? (event.type === 'thinking_started' ? `${current.runId}:thinking:${timestamp}` : event.type === 'thinking_ended' ? current.activeThinkingId ?? undefined : undefined), status: event.status === 'failed' ? 'failed' : event.status === 'cancelled' ? 'cancelled' : event.type === 'tool_result' ? 'completed' : undefined, timestamp }
  return null
}
