import type { ExecutionEventState, ExecutionNodeStatus, ExecutionSnapshot, ExecutionStepState, TodoItem, TodoStatus } from '../../shared/types'

export type { ExecutionNodeStatus } from '../../shared/types'
export type ExecutionEventType = 'thinking_started' | 'thinking_ended' | 'tool_started' | 'tool_result' | 'assistant_content_started' | 'run_completed' | 'run_failed' | 'run_cancelled'

export type ExecutionStep = ExecutionStepState

export interface ExecutionState extends ExecutionSnapshot {
  events: ExecutionEventState[]
}

export type ExecutionInput = {
  type: ExecutionEventType | 'run_completed' | 'run_failed' | 'run_cancelled'
  eventId?: string
  stepId?: string
  toolCallId?: string
  thinkingId?: string
  status?: Exclude<ExecutionNodeStatus, 'pending' | 'running'>
  timestamp: number
}

/**
 * 待办七态压到执行节点五态。
 * blocked 归入 pending：它仍是待办事项，只是暂时推不动，步骤条上不该显示成已结算。
 * skipped 归入 cancelled：主动放弃与不再适用，在执行轨迹上是同一种「不会再执行」。
 */
export function todoStatusToNode(status: TodoStatus): ExecutionNodeStatus {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled' || status === 'skipped') return 'cancelled'
  // in_progress 的推进由 reducer 负责，这里不直接置 running
  return 'pending'
}

export function createExecutionState(runId: string, todos: TodoItem[]): ExecutionState {
  return {
    runId,
    status: 'running',
    steps: todos.map((item, position) => ({ id: item.id, content: item.content, position: item.position ?? position, status: todoStatusToNode(item.status) })),
    events: [],
    activeStepId: null,
    activeEventId: null,
    activeThinkingId: null
  }
}

export function syncExecutionSteps(state: ExecutionState, todos: TodoItem[]): ExecutionState {
  const existing = new Map(state.steps.map((step) => [step.id, step]))
  const steps: ExecutionStep[] = todos.map((item, position) => {
    const prior = existing.get(item.id)
    return { id: item.id, content: item.content, position: item.position ?? position, status: prior?.status ?? todoStatusToNode(item.status) }
  })
  return { ...state, steps }
}

function terminal(type: ExecutionEventType): ExecutionNodeStatus | null {
  if (type === 'run_completed') return 'completed'
  if (type === 'run_failed') return 'failed'
  if (type === 'run_cancelled') return 'cancelled'
  return null
}

function nextStep(steps: ExecutionStep[], currentId: string | null): ExecutionStep | null {
  const currentPosition = steps.find((step) => step.id === currentId)?.position ?? -1
  return [...steps].sort((a, b) => a.position - b.position).find((step) => step.position > currentPosition && step.status === 'pending')
    ?? [...steps].sort((a, b) => a.position - b.position).find((step) => step.status === 'pending')
    ?? null
}

function settleActive(state: ExecutionState, status: ExecutionNodeStatus): ExecutionState {
  return {
    ...state,
    steps: state.steps.map((step) => step.status === 'running' ? { ...step, status } : step),
    events: state.events.map((event) => event.status === 'running' ? { ...event, status: status as ExecutionNodeStatus, completedAt: event.completedAt ?? Date.now() } : event),
    activeStepId: null,
    activeEventId: null,
    activeThinkingId: null
  }
}

export function reduceExecutionState(state: ExecutionState, input: ExecutionInput): ExecutionState {
  const runStatus = terminal(input.type)
  if (runStatus) return settleActive({ ...state, status: runStatus }, runStatus)

  const eventId = input.eventId ?? `${state.runId}:${state.events.length + 1}`
  const existing = state.events.find((event) => event.eventId === eventId)
  if (existing) {
    if (input.type === 'tool_result' || input.type === 'thinking_ended') {
      const status = input.status ?? (input.type === 'tool_result' ? 'completed' : 'completed')
      const events: ExecutionEventState[] = state.events.map((event) => event.eventId === eventId ? { ...event, status: status as ExecutionNodeStatus, completedAt: input.timestamp } : event)
      const activeEventId = state.activeEventId === eventId ? null : state.activeEventId
      const activeThinkingId = existing.thinkingId && state.activeThinkingId === existing.thinkingId ? null : state.activeThinkingId
      const stepId = existing.stepId
      const step = stepId ? state.steps.find((item) => item.id === stepId) : undefined
      const steps = step && step.status === 'running' && !events.some((event) => event.stepId === stepId && event.status === 'running')
        ? state.steps.map((item) => item.id === stepId ? { ...item, status } : item)
        : state.steps
      const current = steps.find((item) => item.id === stepId)
      const advanced = current?.status === 'completed' ? nextStep(steps, stepId) : null
      return { ...state, events, steps: advanced ? steps.map((item) => item.id === advanced.id ? { ...item, status: 'running' } : item) : steps, activeStepId: advanced?.id ?? (activeEventId ? state.activeStepId : null), activeEventId, activeThinkingId }
    }
    return state
  }

  const stepId = input.stepId ?? state.activeStepId ?? nextStep(state.steps, null)?.id ?? null
  const steps: ExecutionStep[] = stepId ? state.steps.map((step) => step.id === stepId && step.status === 'pending' ? { ...step, status: 'running' as ExecutionNodeStatus } : step) : state.steps
  const isThinkingEnd = input.type === 'thinking_ended' || input.type === 'assistant_content_started' || input.type === 'tool_started'
  const events: ExecutionEventState[] = isThinkingEnd
    ? state.events.map((event) => event.thinkingId && event.status === 'running' ? { ...event, status: 'completed' as ExecutionNodeStatus, completedAt: input.timestamp } : event)
    : state.events
  const event: ExecutionEventState = { eventId, type: input.type as ExecutionEventState['type'], stepId, toolCallId: input.toolCallId, thinkingId: input.thinkingId, status: input.type === 'thinking_started' || input.type === 'tool_started' ? 'running' : 'completed', startedAt: input.timestamp, completedAt: input.type === 'thinking_started' || input.type === 'tool_started' ? null : input.timestamp }
  return {
    ...state,
    steps,
    events: [...events, event],
    activeStepId: stepId,
    activeEventId: event.status === 'running' ? eventId : null,
    activeThinkingId: input.type === 'thinking_started' ? input.thinkingId ?? eventId : isThinkingEnd ? null : state.activeThinkingId
  }
}
