import { describe, expect, it } from 'vitest'
import type { Attachment } from '../../shared/types'
import { appendAttachments, droppedImageCount } from './attachments'

function attachment(id: string, localPath?: string): Attachment {
  return { id, name: id, type: 'text/plain', size: 1, localPath }
}

function image(id: string): Attachment {
  return { id, name: `${id}.png`, type: 'image/png', size: 1, localPath: `K:/x/${id}.png` }
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

describe('droppedImageCount', () => {
  it('多模态模型不丢图片', () => {
    expect(droppedImageCount([image('a'), image('b')], 'multimodal')).toBe(0)
  })

  it('纯文本模型丢掉全部图片，非图片附件不计入', () => {
    expect(droppedImageCount([image('a'), attachment('doc', 'K:/x/doc.txt')], 'chat')).toBe(1)
  })

  it('能力未知时按纯文本处理', () => {
    expect(droppedImageCount([image('a')], undefined)).toBe(1)
  })
})
