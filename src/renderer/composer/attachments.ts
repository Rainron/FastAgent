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

export function appendAttachments(current: Attachment[], added: Attachment[]): Attachment[] {
  const existing = new Set(current.map((attachment) => attachment.localPath).filter(Boolean))
  return [...current, ...added.filter((attachment) => !attachment.localPath || !existing.has(attachment.localPath))]
}
