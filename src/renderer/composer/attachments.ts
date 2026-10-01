import type { Attachment } from '../../shared/types'

export function attachmentFromFile(file: File): Attachment {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    localPath: window.fastAgent.files.getPath(file) || undefined
  }
}

export function attachmentsFromClipboard(data: DataTransfer): Attachment[] {
  return Array.from(data.files).map(attachmentFromFile).filter((attachment) => Boolean(attachment.localPath))
}

/**
 * 模型没声明多模态时，运行时会把图片块整体换成「image omitted」占位文本，
 * 模型只会回答自己没收到图片。发送前先数出会被丢掉的张数，好在输入区直说。
 */
export function droppedImageCount(attachments: Attachment[], modelKind: 'chat' | 'multimodal' | undefined): number {
  if (modelKind === 'multimodal') return 0
  return attachments.filter((attachment) => attachment.type.startsWith('image/')).length
}

export function appendAttachments(current: Attachment[], added: Attachment[]): Attachment[] {
  const existing = new Set(current.map((attachment) => attachment.localPath).filter(Boolean))
  return [...current, ...added.filter((attachment) => !attachment.localPath || !existing.has(attachment.localPath))]
}
