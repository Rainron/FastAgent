import type { ResumableRun, TodoItem } from '../../shared/types'

/** 续跑提示里最多列几条待办。全列会把一个长计划整份塞回 prompt，挤掉真正的上下文。 */
const MAX_LISTED_TODOS = 8
/** 中断回合的原始请求截断长度：够模型认出「上次要做什么」即可。 */
const MAX_GOAL_CHARS = 400

function truncate(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
}

/** 仍需推进的待办：已完成、已取消、已跳过都不再列出，failed 与 blocked 要列（它们是待处理的问题）。 */
export function pendingTodos(todos: readonly TodoItem[]): TodoItem[] {
  return todos.filter((item) => item.status !== 'completed' && item.status !== 'cancelled' && item.status !== 'skipped')
}

function describeTodo(item: TodoItem): string {
  const phase = item.phase ? `[${item.phase}] ` : ''
  const mark = item.status === 'blocked' ? '（阻塞）' : item.status === 'failed' ? '（上次失败）' : item.status === 'in_progress' ? '（进行中）' : ''
  return `- ${phase}${item.content}${mark}`
}

/**
 * 构造「继续上一轮」送进模型的提示。
 *
 * 不重放已完成的步骤：pi 的 session 文件里完整历史都在，模型自己看得到做过什么。
 * 这段提示只负责说清「上次为什么停」与「还剩什么」，并明确禁止从头再来一遍——
 * 中断恢复最常见的失败模式就是模型把已经改好的文件重新写一遍。
 */
export function buildResumePrompt(input: {
  goal: string
  reason: string | null
  todos: readonly TodoItem[]
  changedFiles: number
}): string {
  const remaining = pendingTodos(input.todos)
  const lines: string[] = ['上一轮任务被中断，现在继续。']
  if (input.reason) lines.push(`中断原因：${input.reason}`)
  lines.push(`原始请求：${truncate(input.goal, MAX_GOAL_CHARS)}`)
  if (input.changedFiles > 0) {
    lines.push(`上一轮已经改动了 ${input.changedFiles} 个文件，这些改动仍在工作区里，不要重做。`)
  }
  if (remaining.length) {
    lines.push('', '未完成的待办：')
    for (const item of remaining.slice(0, MAX_LISTED_TODOS)) lines.push(describeTodo(item))
    if (remaining.length > MAX_LISTED_TODOS) lines.push(`- …另有 ${remaining.length - MAX_LISTED_TODOS} 项，用 todowrite 查看并维护`)
  }
  lines.push(
    '',
    '先确认当前工作区的实际状态（已改的文件、已建的目录），再从中断处继续。',
    '不要重头执行整个任务，不要重复已完成的步骤，也不要复述上面这段说明。'
  )
  return lines.join('\n')
}

/** 中断的运行是否值得提供「继续上一轮」入口。全部做完的中断没有续跑价值。 */
export function isResumable(run: Pick<ResumableRun, 'pendingTodos' | 'changedFiles'>): boolean {
  return run.pendingTodos > 0 || run.changedFiles > 0
}
