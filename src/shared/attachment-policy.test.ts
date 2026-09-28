import { describe, expect, it } from 'vitest'
import { DEFAULT_ATTACHMENT_POLICY, MB, attachmentValidationError, normalizeAttachmentPolicy } from './attachment-policy'

describe('attachment policy', () => {
  it('uses the requested defaults', () => {
    expect(DEFAULT_ATTACHMENT_POLICY.attachmentMaxFileSizeMb).toBe(30)
    expect(DEFAULT_ATTACHMENT_POLICY.attachmentMaxImageSizeMb).toBe(5)
  })

  it('rejects unsupported types and size limits', () => {
    expect(attachmentValidationError({ name: 'a.exe', type: 'application/octet-stream', size: 1 })).toContain('暂不支持')
    expect(attachmentValidationError({ name: 'a.png', type: 'image/png', size: 6 * MB })).toContain('5 MB')
    expect(attachmentValidationError({ name: 'a.txt', type: 'text/plain', size: 31 * MB })).toContain('30 MB')
  })

  it('normalizes configured extensions and invalid limits', () => {
    const policy = normalizeAttachmentPolicy({ attachmentMaxFileSizeMb: 0, attachmentFileExtensions: [' .TXT ', 'txt', 'bad type'] })
    expect(policy.attachmentMaxFileSizeMb).toBe(30)
    expect(policy.attachmentFileExtensions).toEqual(['txt'])
  })
})
