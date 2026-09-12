import type { AgentEvent, TodoItem } from '../../shared/types'

/** 执行中显示「26s」，完成后显示「8m 42s」。 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export interface TodoStats {
  total: number
  completed: number
  failed: number
  blocked: number
  skipped: number
  cancelled: number
  pending: number
  /** 当前执行中的条目，没有则为 null */
  current: TodoItem | null
  /** 当前处于第几阶段（1 基），全部完成时等于 total */
  stage: number
  percent: number
}

/** 不会再推进的状态。stage 推进与「还剩多少」都按它判定。 */
const SETTLED: ReadonlySet<TodoItem['status']> = new Set(['completed', 'cancelled', 'failed', 'skipped'])

/** 完整计划始终按阶段编号 1→N 展示：仅按 position 升序，缺失 position 排末尾，并列时保持原始顺序，与任务状态无关。 */
export function sortTodoItems(items: TodoItem[]): TodoItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const pa = a.item.position
      const pb = b.item.position
      if (pa != null && pb != null) return pa !== pb ? pa - pb : a.index - b.index
      // 一方缺失时缺失者排末尾，避免返回 0 造成非传递排序。
      if (pa == null && pb == null) return a.index - b.index
      return pa == null ? 1 : -1
    })
    .map((entry) => entry.item)
}

/** 只做计数与排序，不掺展示细节，方便单测覆盖。 */
export function todoStats(items: TodoItem[]): TodoStats {
  const sorted = sortTodoItems(items)
  const count = (status: TodoItem['status']) => sorted.filter((item) => item.status === status).length
  const completed = count('completed')
  const current = sorted.find((item) => item.status === 'in_progress') ?? null
  // 阶段号按第一个未结算项算：skipped / cancelled / failed 都已结算，
  // 只看 completed 会让跳过的步骤把阶段号永久卡在原地。
  const firstOpen = sorted.find((item) => !SETTLED.has(item.status))
  const stage = firstOpen ? sorted.indexOf(firstOpen) + 1 : sorted.length
  const total = sorted.length
  return {
    total,
    completed,
    failed: count('failed'),
    blocked: count('blocked'),
    skipped: count('skipped'),
    cancelled: count('cancelled'),
    pending: count('pending'),
    current,
    stage,
    percent: total ? Math.round((completed / total) * 100) : 0
  }
}

export interface TodoPhaseGroup {
  /** null 表示未分组；全部条目都没有 phase 时只会有这一个分组。 */
  phase: string | null
  items: TodoItem[]
}

/**
 * 按阶段分组。全部无 phase 时返回单个 null 分组，让 Plan 面板的扁平渲染路径保持原样。
 * 分组内保持 sortTodoItems 的顺序；分组之间按 phasePosition 升序，缺省视为 0。
 */
export function groupTodosByPhase(items: TodoItem[]): TodoPhaseGroup[] {
  const sorted = sortTodoItems(items)
  if (!sorted.some((item) => item.phase)) return [{ phase: null, items: sorted }]
  const groups = new Map<string, { order: number; items: TodoItem[] }>()
  for (const item of sorted) {
    // 混合输入里没有 phase 的条目归到一个显式分组，不能丢
    const key = item.phase ?? ''
    const existing = groups.get(key)
    if (existing) {
      existing.items.push(item)
      continue
    }
    // 分组序取该阶段首个条目的 phasePosition：同组内个别条目缺省 0 时，
    // 取最小值会把整组拉到最前，首现值才与 assignPhasePositions 的分配一致。
    groups.set(key, { order: item.phasePosition ?? 0, items: [item] })
  }
  return [...groups.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([phase, group]) => ({ phase: phase || null, items: group.items }))
}

/** 完成态摘要：文件修改与命令执行次数，来源只有事件流里可证实的信息。 */
export function todoSummary(events: AgentEvent[]): { files: number; commands: number } {
  return {
    files: events.filter((event) => event.type === 'file_changed').length,
    commands: events.filter((event) => event.type === 'tool_started' && (event.tool === 'bash' || event.tool === 'powershell')).length
  }
}
