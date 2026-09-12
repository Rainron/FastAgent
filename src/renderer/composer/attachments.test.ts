import { describe, expect, it } from 'vitest'
import type { Attachment } from '../../shared/types'
import { appendAttachments } from './attachments'

function attachment(id: string, localPath?: string): Attachment {
  return { id, name: id, type: 'text/plain', size: 1, localPath }
}

describe('appendAttachments', () => {
  it('按 localPath 去重，已在列表里的不再追加', () => {
    const current = [attachment('a', 'K:/x/a.txt')]
    const next = appendAttachments(current, [attachment('b', 'K:/x/a.txt'), attachment('c', 'K:/x/c.txt')])
    expect(next.map((item) => item.id)).toEqual(['a', 'c'])
  })

  it('没有 localPath 的条目不参与去重，一律追加', () => {
    const next = appendAttachments([attachment('a')], [attachment('b'), attachment('c')])
    expect(next).toHaveLength(3)
  })

  it('不修改传入的数组', () => {
    const current = [attachment('a', 'K:/x/a.txt')]
    appendAttachments(current, [attachment('b', 'K:/x/b.txt')])
    expect(current).toHaveLength(1)
  })
})
