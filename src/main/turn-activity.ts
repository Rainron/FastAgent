import type { AgentEvent } from '../shared/types'

/**
 * 落库用的事件副本：去掉 execution。
 *
 * 每条事件都带一份整轮执行快照，快照又随事件数增长，落库后 activity 体积是 O(N²)——
 * 实测一轮 193 条事件里 94% 的字节都是这些重复快照。历史侧从不读它：渲染进程读顶层
 * activity.execution，实时流读的是 IPC 推来的事件，两条路都不经过库。
 */
export function persistableEvent(event: AgentEvent): AgentEvent {
  if (!event.execution) return event
  const { execution: _execution, ...rest } = event
  return rest
}

/** 历史 activity 的同款清洗：只动 events[].execution，顶层快照与其余字段原样保留。 */
export function stripEventExecutions(activity: unknown): { activity: unknown; stripped: number } {
  if (!activity || typeof activity !== 'object') return { activity, stripped: 0 }
  const events = (activity as { events?: unknown }).events
  if (!Array.isArray(events)) return { activity, stripped: 0 }
  let stripped = 0
  const nextEvents = events.map((event) => {
    if (!event || typeof event !== 'object' || !('execution' in event)) return event
    stripped += 1
    const { execution: _execution, ...rest } = event as Record<string, unknown>
    return rest
  })
  return stripped ? { activity: { ...(activity as object), events: nextEvents }, stripped } : { activity, stripped: 0 }
}
