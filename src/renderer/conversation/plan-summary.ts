import type { ConversationTurn, TodoItem, TodoStatus } from '../../shared/types'
import { todoStats } from './todo-status'

export interface ConversationPlanGroup { turn: ConversationTurn; items: TodoItem[] }
export type PlanStatus = 'working' | 'done' | 'blocked' | 'failed' | 'pending'
export function conversationPlans(turns: ConversationTurn[], todosByTurn: Record<string, TodoItem[]>): ConversationPlanGroup[] {
  return turns.map((turn) => ({ turn, items: todosByTurn[turn.id] ?? [] })).filter((group) => group.items.length > 0)
}
export function planGroupStatus(items: TodoItem[]): PlanStatus {
  if (items.some((item) => item.status === 'in_progress')) return 'working'
  if (items.some((item) => item.status === 'failed')) return 'failed'
  if (items.some((item) => item.status === 'blocked')) return 'blocked'
  if (items.some((item) => item.status === 'pending')) return 'pending'
  return 'done'
}
export function planOverallStatus(groups: ConversationPlanGroup[]): PlanStatus {
  return planGroupStatus(groups.flatMap((group) => group.items))
}
export function planOverallLabel(status: PlanStatus): string {
  return { working: '进行中', done: '已完成', blocked: '已阻塞', failed: '失败', pending: '待处理' }[status]
}
export function planStatusLabel(status: TodoStatus): string {
  return { pending: '待处理', in_progress: '进行中', completed: '已完成', cancelled: '已取消', blocked: '已阻塞', failed: '失败', skipped: '已跳过' }[status]
}
export function planProgress(groups: ConversationPlanGroup[]) {
  const stats = todoStats(groups.flatMap((group) => group.items))
  return { completed: stats.completed, total: stats.total, percent: stats.percent }
}
