import type { ConversationMode, ModelOption } from '../shared/types'

export function nextConversationMode(mode: ConversationMode): ConversationMode {
  return mode === 'chat' ? 'agent' : 'chat'
}

export function nextModelId(currentId: number | null, models: Array<Pick<ModelOption, 'id'>>): number | null {
  if (models.length === 0) return null
  const currentIndex = models.findIndex((model) => model.id === currentId)
  return models[(currentIndex + 1 + models.length) % models.length]?.id ?? null
}

export function isNewConversationShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>): boolean {
  return event.key.toLowerCase() === 'n' && (event.ctrlKey || event.metaKey)
}

const CONTINUATION_INPUT_RE = /^(继续|继续执行|接着做|继续做|继续完成)/

export function isContinuationInput(text: string): boolean {
  return CONTINUATION_INPUT_RE.test(text.trim())
}

export function buildContinuationPrompt(input = '继续执行'): string {
  return `${input.trim() || '继续执行'}\n\n请基于会话中的当前进度，从第一个未完成待办继续；不要重做已完成步骤，不要复述或重新规划整个任务。控制单次输出长度，完成一部分后及时更新待办并继续。`
}

export function pushNavigation<T>(entries: T[], index: number, next: T): { entries: T[]; index: number } {
  if (entries[index] === next) return { entries, index }
  return { entries: [...entries.slice(0, index + 1), next], index: index + 1 }
}

export function stepNavigation<T>(entries: T[], index: number, direction: -1 | 1): { index: number; target: T } | null {
  const nextIndex = index + direction
  const target = entries[nextIndex]
  return target === undefined ? null : { index: nextIndex, target }
}
