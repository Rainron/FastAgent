import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Attachment } from '../shared/types'
import { attachmentValidationError, type AttachmentPolicy } from '../shared/attachment-policy'

export function archiveAttachments(root: string, conversationId: string, attachments: Attachment[], policy?: Partial<AttachmentPolicy>): Attachment[] {
  if (attachments.length === 0) return []
  if (!/^[a-zA-Z0-9_-]+$/.test(conversationId)) throw new Error('会话标识无效')
  const targetDir = join(root, conversationId)
  mkdirSync(targetDir, { recursive: true })
  return attachments.map((attachment) => {
    if (!attachment.localPath) return attachment
    const source = attachment.localPath
    const suffix = extname(attachment.name || source) || extname(source)
    const size = statSync(source).size
    const validationError = attachmentValidationError({ name: attachment.name, type: attachment.type, size }, policy)
    if (validationError) throw new Error(validationError)
    const sourceRelative = relative(resolve(root), resolve(source))
    if (!isAbsolute(sourceRelative) && !sourceRelative.startsWith(`..${sourceRelative.includes('\\') ? '\\' : '/'}`)) return { ...attachment, size }
    const target = join(targetDir, `${randomUUID()}${suffix}`)
    copyFileSync(source, target)
    return { ...attachment, localPath: target, size }
  })
}
