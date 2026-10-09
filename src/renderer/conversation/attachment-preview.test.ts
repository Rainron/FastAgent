import { describe, expect, it } from 'vitest'
import type { Attachment } from '../../shared/types'
import { attachmentDirectory, attachmentExtension, attachmentMetaRows, attachmentPreviewKind, attachmentTypeLabel, formatAttachmentBytes } from './attachment-preview'

const attachment = (name: string, type = ''): Attachment => ({ id: name, name, type, size: 1024 })

describe('attachment-preview', () => {
  it('按 MIME 与扩展名判定预览形态', () => {
    expect(attachmentPreviewKind(attachment('a.png', 'image/png'))).toBe('image')
    expect(attachmentPreviewKind(attachment('readme.md'))).toBe('markdown')
    expect(attachmentPreviewKind(attachment('notes.txt', 'text/plain'))).toBe('text')
    expect(attachmentPreviewKind(attachment('data.csv', 'application/octet-stream'))).toBe('text')
    expect(attachmentPreviewKind(attachment('report.pdf', 'application/pdf'))).toBe('binary')
    expect(attachmentPreviewKind(attachment('archive.zip'))).toBe('binary')
  })
  it('svg 归到文本预览而不是图片', () => {
    expect(attachmentPreviewKind(attachment('icon.svg', 'image/svg+xml'))).toBe('text')
  })
  it('扩展名与类型标签', () => {
    expect(attachmentExtension('a.tar.gz')).toBe('gz')
    expect(attachmentExtension('Makefile')).toBe('')
    expect(attachmentTypeLabel(attachment('report.pdf', 'application/pdf'))).toBe('PDF')
    expect(attachmentTypeLabel(attachment('Makefile', 'application/octet-stream'))).toBe('OCTET-STREAM')
    expect(attachmentTypeLabel(attachment('Makefile'))).toBe('文件')
  })
  it('元数据行：基础四项固定给出，行数与尺寸按需追加', () => {
    const file: Attachment = { id: 'a', name: 'log.txt', type: 'text/plain', size: 2048, localPath: 'C:\\data\\log.txt' }
    expect(attachmentMetaRows(file).map((row) => row.label)).toEqual(['类型', '大小', 'MIME', '位置'])
    expect(attachmentMetaRows(file, { lines: 12 }).find((row) => row.label === '行数')?.value).toBe('12 行')
    expect(attachmentMetaRows(file, { pixels: '800 × 600' }).find((row) => row.label === '尺寸')?.value).toBe('800 × 600')
  })
  it('元数据行：没有 MIME 与本地路径时的兜底', () => {
    const rows = attachmentMetaRows({ id: 'a', name: 'Makefile', type: '', size: 10 })
    expect(rows.map((row) => row.label)).toEqual(['类型', '大小', '位置'])
    expect(rows.at(-1)?.value).toBe('无本地路径')
  })
  it('字节数展示到 B / KB / MB 三档', () => {
    expect(formatAttachmentBytes(512)).toBe('512 B')
    expect(formatAttachmentBytes(2048)).toBe('2.0 KB（2,048 字节）')
    expect(formatAttachmentBytes(3 * 1048576)).toBe('3.00 MB（3,145,728 字节）')
  })
  it('切出所在目录，兼容两种分隔符', () => {
    expect(attachmentDirectory('C:\\data\\attachments\\a.txt')).toBe('C:\\data\\attachments')
    expect(attachmentDirectory('/home/demo/a.txt')).toBe('/home/demo')
    expect(attachmentDirectory('a.txt')).toBe('a.txt')
  })
})
