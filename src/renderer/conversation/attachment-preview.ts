import type { Attachment } from '../../shared/types'

/** 预览形态：图片直接显示，markdown 走渲染器，text 走代码视图，binary 只给元信息与系统打开。 */
export type AttachmentPreviewKind = 'image' | 'markdown' | 'text' | 'binary'

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx']
/** 扩展名兜底：拖进来的文件 MIME 常是空的或 application/octet-stream，光看 type 判不出文本。 */
const TEXT_EXTENSIONS = [
  'txt', 'log', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'vue', 'svelte', 'html', 'htm', 'css', 'scss', 'less',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'swift', 'sql',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'dockerfile', 'gradle', 'gitignore', 'patch', 'diff', 'xml', 'svg'
]

export function attachmentExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function attachmentPreviewKind(attachment: Attachment): AttachmentPreviewKind {
  const extension = attachmentExtension(attachment.name)
  // svg 既是图片又是文本：附件缩略图那条链路读不了 svg，这里按文本预览，至少能看到内容。
  if (attachment.type.startsWith('image/') && extension !== 'svg') return 'image'
  if (MARKDOWN_EXTENSIONS.includes(extension)) return 'markdown'
  if (attachment.type.startsWith('text/') || TEXT_EXTENSIONS.includes(extension)) return 'text'
  if (attachment.type === 'application/json' || attachment.type === 'application/xml') return 'text'
  return 'binary'
}

/** 元信息卡上的类型标签：优先扩展名，没有扩展名时退回 MIME 的子类型。 */
export function attachmentTypeLabel(attachment: Attachment): string {
  const extension = attachmentExtension(attachment.name)
  if (extension) return extension.toUpperCase()
  const subtype = attachment.type.split('/')[1]
  return subtype ? subtype.toUpperCase() : '文件'
}

export interface AttachmentMetaRow { label: string; value: string }

/**
 * 预览面板的元数据行：能预览时跟正文一起显示，不能预览时它就是正文。
 * 行数与像素尺寸要等内容读出来才有，读不到就不出这一行。
 */
export function attachmentMetaRows(attachment: Attachment, extra: { lines?: number; pixels?: string } = {}): AttachmentMetaRow[] {
  const rows: AttachmentMetaRow[] = [
    { label: '类型', value: attachmentTypeLabel(attachment) },
    { label: '大小', value: formatAttachmentBytes(attachment.size) }
  ]
  if (attachment.type) rows.push({ label: 'MIME', value: attachment.type })
  if (extra.pixels) rows.push({ label: '尺寸', value: extra.pixels })
  if (extra.lines !== undefined) rows.push({ label: '行数', value: `${extra.lines} 行` })
  rows.push({ label: '位置', value: attachment.localPath || '无本地路径' })
  return rows
}

/** 元信息区要的是精确字节，和芯片上那个 1K/2.4M 的概数不是一回事。 */
export function formatAttachmentBytes(size: number): string {
  if (size < 1024) return `${size} B`
  const value = size >= 1048576 ? `${(size / 1048576).toFixed(2)} MB` : `${(size / 1024).toFixed(1)} KB`
  return `${value}（${size.toLocaleString('zh-CN')} 字节）`
}

/** 「打开所在文件夹」用：渲染进程没有 node path，按最后一个分隔符切。 */
export function attachmentDirectory(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index > 0 ? path.slice(0, index) : path
}
