import type { AgentEvent } from '../shared/types'

export type ActivityRunStatus = 'idle' | 'working' | 'done'

/** 事件自带的回合归属最可靠，映射仅兼容旧事件或桥接层未携带 turnId 的情况。 */
export function resolveEventTurnId(event: Pick<AgentEvent, 'turnId'>, mappedTurnId: string | undefined, activeTurnId: string | null): string | null {
  return event.turnId || mappedTurnId || activeTurnId
}

export function nextActivityRunStatus(current: ActivityRunStatus, eventType: AgentEvent['type']): ActivityRunStatus {
  if (eventType === 'completed' || eventType === 'failed' || eventType === 'cancelled' || eventType === 'interrupted') return 'done'
  return current === 'done' ? 'done' : 'working'
}

export interface ToolCallGroup {
  toolCallId: string
  toolName: string
  events: AgentEvent[]
}

/** 带 toolCallId 的事件属于工具卡片；无 toolCallId（旧数据）不进卡片。 */
function isToolCardEvent(event: AgentEvent): boolean {
  return Boolean(event.toolCallId)
}

/** 把 tool_started / tool_result / approval_required / question_required 按 toolCallId 聚合成卡片。 */
export function groupToolCallEvents(events: AgentEvent[]): ToolCallGroup[] {
  const groups = new Map<string, ToolCallGroup>()
  for (const event of events) {
    if (!isToolCardEvent(event)) continue
    const existing = groups.get(event.toolCallId as string)
    if (existing) {
      existing.events.push(event)
    } else {
      groups.set(event.toolCallId as string, { toolCallId: event.toolCallId as string, toolName: event.tool ?? 'tool', events: [event] })
    }
  }
  return [...groups.values()]
}
