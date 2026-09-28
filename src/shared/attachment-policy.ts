import type { AppSettings } from './types'

export type AttachmentPolicy = Pick<AppSettings, 'attachmentMaxFileSizeMb' | 'attachmentMaxImageSizeMb' | 'attachmentFileExtensions' | 'attachmentImageExtensions'>
export const MB = 1024 * 1024
export const MAX_ATTACHMENT_LIMIT_MB = 500
export const DEFAULT_ATTACHMENT_POLICY: AttachmentPolicy = {
  attachmentMaxFileSizeMb: 30,
  attachmentMaxImageSizeMb: 5,
  attachmentFileExtensions: ['pdf', 'txt', 'md', 'json', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'ts', 'tsx', 'js', 'jsx', 'py', 'yaml', 'yml', 'html', 'css', 'log'],
  attachmentImageExtensions: ['png', 'jpg', 'jpeg', 'gif', 'webp']
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', ico: 'image/x-icon'
}

export function normalizeAttachmentExtensions(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase().replace(/^\./, '')).filter((value) => /^[a-z0-9][a-z0-9_-]*$/.test(value)))]
}

export function normalizeAttachmentPolicy(input: Partial<AttachmentPolicy> = {}): AttachmentPolicy {
  const limit = (value: number | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_ATTACHMENT_LIMIT_MB ? value : fallback
  const extensions = (value: string[] | undefined, fallback: string[]) => Array.isArray(value) ? normalizeAttachmentExtensions(value.filter((item) => typeof item === 'string')) : [...fallback]
  return {
    attachmentMaxFileSizeMb: limit(input.attachmentMaxFileSizeMb, 30),
    attachmentMaxImageSizeMb: limit(input.attachmentMaxImageSizeMb, 5),
    attachmentFileExtensions: extensions(input.attachmentFileExtensions, DEFAULT_ATTACHMENT_POLICY.attachmentFileExtensions),
    attachmentImageExtensions: extensions(input.attachmentImageExtensions, DEFAULT_ATTACHMENT_POLICY.attachmentImageExtensions)
  }
}

export function attachmentExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase()
}

export function attachmentMimeType(file: { name: string; type: string }): string {
  return IMAGE_TYPES[attachmentExtension(file.name)] ?? (file.type || 'application/octet-stream')
}

export function attachmentValidationError(file: { name: string; type: string; size: number }, settings: Partial<AttachmentPolicy> = {}): string | null {
  const policy = normalizeAttachmentPolicy(settings)
  const extension = attachmentExtension(file.name)
  const image = attachmentMimeType(file).startsWith('image/') || policy.attachmentImageExtensions.includes(extension)
  const allowed = image ? policy.attachmentImageExtensions : policy.attachmentFileExtensions
  if (!allowed.includes(extension)) return `${file.name}：暂不支持此${image ? '图片' : '文件'}类型`
  if (!Number.isFinite(file.size) || file.size < 0) return `${file.name}：文件大小无效`
  const maxMb = image ? Math.min(policy.attachmentMaxImageSizeMb, policy.attachmentMaxFileSizeMb) : policy.attachmentMaxFileSizeMb
  return file.size > maxMb * MB ? `${file.name}：超过${image ? '图片' : '文件'}大小限制（${maxMb} MB）` : null
}
