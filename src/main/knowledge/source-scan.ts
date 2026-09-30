import { classifySecretPath } from '../agent/safety/secret-file-guard'
import { matchPattern } from '../../shared/pattern-matcher'
import type { ChunkKind } from './chunk-text'

/** 首批支持的正文格式；扫描件 OCR 与复杂 Office 格式不在范围内。 */
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])
const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'rst', 'adoc', 'org', 'csv', 'tsv',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'ps1', 'sql', 'graphql', 'proto',
  'html', 'css', 'scss', 'less', 'vue', 'svelte'
])

/** 目录绑定默认排除：这些目录进知识库只会灌进噪声，且体量远超正文。 */
export const DEFAULT_EXCLUDES = [
  'node_modules', '.git', 'dist', 'build', 'out', 'release', 'target', 'vendor',
  '.venv', 'venv', '__pycache__', '.next', '.nuxt', 'coverage', '.cache', '.idea', '.vscode'
]

/** 单文件上限：超过这个体量的多半是日志或生成物，切出来的块也没有检索价值。 */
export const MAX_FILE_BYTES = 2_000_000
/** 单个来源的文件数上限，防止误绑一整块盘。 */
export const MAX_SOURCE_FILES = 2_000

export type SkipReason = 'unsupported' | 'excluded' | 'secret' | 'too-large'

export interface ScanCandidate {
  /** 相对来源根目录，统一用 / 分隔；来源是单文件时为文件名。 */
  path: string
  size: number
  kind: ChunkKind | 'pdf'
}

export interface ScanSkipped {
  path: string
  reason: SkipReason
}

export interface ScanResult {
  candidates: ScanCandidate[]
  skipped: ScanSkipped[]
  /** 命中文件数上限被截断；界面要如实告知，不能假装全都索引了。 */
  truncated: boolean
}

function extensionOf(path: string): string {
  const name = path.split('/').at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 文件按扩展名归类；不认识的扩展名一律不进知识库，避免把二进制当文本读。 */
export function classifyFile(path: string): ChunkKind | 'pdf' | null {
  const extension = extensionOf(path)
  if (extension === 'pdf') return 'pdf'
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown'
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  return null
}

/** 任意一段路径命中排除模式就整条排除；模式按段匹配，不是子串匹配。 */
export function isExcluded(path: string, excludes: readonly string[]): boolean {
  const segments = path.split('/').filter(Boolean)
  return excludes.some((pattern) => segments.some((segment) => matchPattern(pattern, segment)) || matchPattern(pattern, path))
}

export interface ScanEntry {
  path: string
  size: number
}

/**
 * 把一批已列出的文件筛成候选。文件系统遍历留给调用方，这里只做判定，方便测。
 * 密钥文件在这一层直接挡掉：知识条目会整段进模型请求，凭据不能默认写进去。
 */
export function selectSourceFiles(entries: readonly ScanEntry[], options: { excludes?: readonly string[]; maxFiles?: number; maxBytes?: number } = {}): ScanResult {
  const excludes = options.excludes ?? DEFAULT_EXCLUDES
  const maxFiles = options.maxFiles ?? MAX_SOURCE_FILES
  const maxBytes = options.maxBytes ?? MAX_FILE_BYTES
  const candidates: ScanCandidate[] = []
  const skipped: ScanSkipped[] = []
  let truncated = false
  for (const entry of entries) {
    const path = entry.path.replace(/\\/g, '/')
    if (isExcluded(path, excludes)) { skipped.push({ path, reason: 'excluded' }); continue }
    if (classifySecretPath(path)) { skipped.push({ path, reason: 'secret' }); continue }
    const kind = classifyFile(path)
    if (!kind) { skipped.push({ path, reason: 'unsupported' }); continue }
    if (entry.size > maxBytes) { skipped.push({ path, reason: 'too-large' }); continue }
    if (candidates.length >= maxFiles) { truncated = true; continue }
    candidates.push({ path, size: entry.size, kind })
  }
  return { candidates, skipped, truncated }
}

const REASON_LABELS: Record<SkipReason, string> = {
  unsupported: '格式暂不支持',
  excluded: '按排除规则跳过',
  secret: '疑似凭据文件，未索引',
  'too-large': '超过单文件大小上限'
}

/** 范围预览用的分组统计；界面要说清「哪些没进来、为什么」。 */
export function summarizeSkipped(skipped: readonly ScanSkipped[]): Array<{ reason: SkipReason; label: string; count: number }> {
  return (Object.keys(REASON_LABELS) as SkipReason[])
    .map((reason) => ({ reason, label: REASON_LABELS[reason], count: skipped.filter((item) => item.reason === reason).length }))
    .filter((group) => group.count > 0)
}
