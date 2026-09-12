import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { AgentEvent, TodoItem, TodoStatus } from '../../../shared/types'

export interface TodoToolContext {
  cwd: string
  namespace: string
  conversationId: string
  setTodos: (namespace: string, conversationId: string, items: TodoItem[]) => TodoItem[]
  listTodos: (namespace: string, conversationId: string) => TodoItem[]
  emit: (event: Omit<AgentEvent, 'runId'>) => void
}

const TODO_STATUS: TodoStatus[] = ['pending', 'in_progress', 'completed', 'cancelled', 'blocked', 'failed', 'skipped']

/**
 * 阶段序按阶段名首次出现的顺序分配，未命名阶段固定为 0。
 * 不按字典序：模型给出的阶段名是「准备/实施/验证」这类中文短语，字典序会把顺序打乱。
 */
export function assignPhasePositions(items: Array<{ phase?: string }>): number[] {
  const order = new Map<string, number>()
  return items.map((item) => {
    if (!item.phase) return 0
    const existing = order.get(item.phase)
    if (existing !== undefined) return existing
    const next = order.size + 1
    order.set(item.phase, next)
    return next
  })
}

export function createTodoTool(context: TodoToolContext): ToolDefinition {
  return defineTool({
    name: 'todowrite',
    label: 'Todo',
    description: '维护任务进度清单（set 全量替换 / update 增量更新），供用户在进度面板查看。可用 phase 把任务分成阶段。',
    promptSnippet: 'Track task progress with a todo list shown to the user',
    promptGuidelines: [
      'Use todowrite to keep the user informed of multi-step task progress; update items as you complete them.',
      'Status semantics: blocked = waiting on something external (say what in content); failed = attempted and failed; skipped = deliberately dropped; cancelled = no longer applicable. Do not collapse all four into cancelled.',
      'Use phase to group items when the task has distinct stages; omit it for a flat list.'
    ],
    parameters: Type.Object({
      action: Type.Union([Type.Literal('set'), Type.Literal('update')], { description: 'set 全量替换；update 按 id 合并' }),
      items: Type.Array(Type.Object({
        id: Type.String(),
        content: Type.String(),
        status: Type.Union(TODO_STATUS.map((status) => Type.Literal(status)), { description: '任务状态' }),
        phase: Type.Optional(Type.String({ description: '所属阶段名；省略表示不分组' }))
      }))
    }),
    async execute(_toolCallId, params) {
      const phasePositions = assignPhasePositions(params.items)
      const incoming = params.items.map((item, position): TodoItem => ({
        id: item.id,
        content: item.content,
        status: item.status as TodoStatus,
        position,
        ...(item.phase ? { phase: item.phase, phasePosition: phasePositions[position] } : {})
      }))
      const next = params.action === 'set'
        ? incoming
        : (() => {
            const existing = new Map(context.listTodos(context.namespace, context.conversationId).map((item) => [item.id, item]))
            for (const item of incoming) existing.set(item.id, item)
            return [...existing.values()]
          })()
      const saved = context.setTodos(context.namespace, context.conversationId, next)
      context.emit({ type: 'todo_changed', detail: `待办已更新（${saved.length} 项）`, todos: saved, status: 'completed' })
      return {
        content: [{ type: 'text', text: `待办清单已更新：共 ${saved.length} 项。` }],
        details: { todos: saved }
      }
    }
  })
}