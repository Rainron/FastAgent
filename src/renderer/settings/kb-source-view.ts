import type { KbIndexResult, KbSource, KbSourcePreview, RecallPreview } from '../../shared/types'

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

/**
 * 知识库页打开时选哪个项目：已选的还在就不动，否则优先当前打开的项目，最后才是列表第一个。
 * 知识库按项目隔离，默认落到别的项目上，用户很容易把条目加错地方。
 */
export function pickKbProject(projectIds: readonly string[], current: string, preferred: string | null): string {
  if (projectIds.includes(current)) return current
  if (preferred && projectIds.includes(preferred)) return preferred
  return projectIds[0] ?? ''
}

/** 解绑确认文案：说清会连带删掉多少条，已导入条目不会保留。 */
export function describeUnlink(source: Pick<KbSource, 'title' | 'entryCount'>): string {
  return `解绑「${source.title}」会同时删除它导入的 ${source.entryCount} 个条目，手工条目不受影响。之后可以重新绑定再索引。`
}

/** 召回测试某一路没有命中时的说明：先说开关和项目这类「根本不会查」的原因，最后才是真没匹配上。 */
export function recallEmptyReason(kind: 'memory' | 'knowledge', preview: Pick<RecallPreview, 'memoryEnabled' | 'knowledgeEnabled'>, projectId: string | null): string {
  if (kind === 'memory') return preview.memoryEnabled ? '没有命中的记忆' : '跨会话记忆已关闭，不会注入记忆'
  if (!preview.knowledgeEnabled) return '知识库自动注入已关闭'
  if (!projectId) return '知识库只在项目会话中注入，请选择项目'
  return '没有命中的知识条目'
}
