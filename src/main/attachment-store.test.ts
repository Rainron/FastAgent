import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { archiveAttachments } from './attachment-store'

describe('archiveAttachments', () => {
  it('copies an attachment into the conversation archive and keeps content', () => {
    const root = mkdtempSync(join(tmpdir(), 'fastagent-archive-'))
    const source = join(root, 'source.txt')
    writeFileSync(source, 'hello')
    const archived = archiveAttachments(join(root, 'attachments'), 'conversation-1', [{ id: 'a', name: 'source.txt', type: 'text/plain', size: 5, localPath: source }])
    expect(archived[0].localPath).not.toBe(source)
    expect(readFileSync(archived[0].localPath!, 'utf8')).toBe('hello')
  })

  it('rejects files over the configured limit', () => {
    const root = mkdtempSync(join(tmpdir(), 'fastagent-archive-'))
    const source = join(root, 'source.txt')
    writeFileSync(source, 'hello')
    expect(() => archiveAttachments(join(root, 'attachments'), 'conversation-1', [{ id: 'a', name: 'source.txt', type: 'text/plain', size: 5, localPath: source }], { attachmentMaxFileSizeMb: 0.000001 })).toThrow('大小限制')
  })
})
