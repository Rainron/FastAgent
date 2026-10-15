import type { Attachment } from '../../shared/types'

export type LineBoundary = 'start' | 'end'

export function lineBoundary(value: string, caret: number, boundary: LineBoundary): number {
  const position = Math.max(0, Math.min(caret, value.length))
  if (boundary === 'start') {
    const newline = value.lastIndexOf('\n', position - 1)
    return newline === -1 ? 0 : newline + 1
  }
  const newline = value.indexOf('\n', position)
  return newline === -1 ? value.length : newline
}

/** Escape 由调用方按覆盖层优先级和当前运行状态决定是否消费。 */
export function isStopConversationShortcut(event: { key: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean; isComposing?: boolean }): boolean {
  return !event.isComposing && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && event.key === 'Escape'
}

/** 清空本地草稿，不影响已经发送、插队或排队的内容。 */
export function clearComposerDraft(_text: string, _attachments: readonly Attachment[]): { text: string; attachments: Attachment[] } {
  return { text: '', attachments: [] }
}
