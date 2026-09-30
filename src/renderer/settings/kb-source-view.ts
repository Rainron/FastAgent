import type { KbIndexResult, KbSource, KbSourcePreview } from '../../shared/types'

const STATUS_LABELS: Record<KbSource['status'], string> = {
  indexing: '索引中',
  indexed: '已索引',
  failed: '索引失败',
  stale: '来源已失效'
}

export function sourceStatusLabel(source: Pick<KbSource, 'status'>): string {
  return STATUS_LABELS[source.status]
}

/** 状态色沿用应用既有的三档语义：失效与失败要显眼，正常态保持安静。 */
export function sourceStatusTone(source: Pick<KbSource, 'status'>): 'ok' | 'warn' | 'danger' {
  if (source.status === 'failed') return 'danger'
  if (source.status === 'stale') return 'warn'
  return 'ok'
}

/** 一行说明：文件数、条目数、第几版。失效来源必须说清它已不参与检索。 */
export function describeSource(source: KbSource): string {
  if (source.status === 'stale') return '路径已不存在，其条目已停止参与检索'
  const parts = [`${source.fileCount} 个文件`, `${source.entryCount} 条`]
  if (source.version > 0) parts.push(`v${source.version}`)
  return parts.join(' · ')
}

/** 导入预览摘要：说清会索引多少、跳过多少、是否被上限截断。 */
export function describePreview(preview: KbSourcePreview): string {
  const parts = [`将索引 ${preview.files.length} 个文件`]
  const skipped = preview.skipped.reduce((sum, group) => sum + group.count, 0)
  if (skipped > 0) parts.push(`跳过 ${skipped} 个`)
  if (preview.truncated) parts.push('已达文件数上限，超出部分未纳入')
  return parts.join(' · ')
}

/** 索引结果提示：如实区分新建、未变、移除与失败，不把部分失败说成全部成功。 */
export function describeIndexResult(result: KbIndexResult): string {
  if (result.source.status === 'stale') return '来源路径已不存在，其条目已停止参与检索'
  const parts: string[] = []
  if (result.indexedFiles) parts.push(`索引 ${result.indexedFiles} 个文件`)
  if (result.unchangedFiles) parts.push(`${result.unchangedFiles} 个未变化`)
  if (result.removedFiles) parts.push(`移除 ${result.removedFiles} 个已删除文件`)
  if (result.failures.length) parts.push(`${result.failures.length} 个失败`)
  if (!parts.length) parts.push('没有可索引的文件')
  return `${parts.join('，')}；当前共 ${result.entryCount} 条`
}

/** 条目的原文出处；手工条目没有出处时返回空串。 */
export function entryOrigin(entry: { sourcePath?: string | null; locator?: string | null }): string {
  if (!entry.sourcePath) return ''
  return entry.locator ? `${entry.sourcePath} ${entry.locator}` : entry.sourcePath
}
