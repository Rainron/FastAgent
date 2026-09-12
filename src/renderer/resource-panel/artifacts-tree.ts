import type { ArtifactGroup, ArtifactType } from '../../shared/types'

/** Artifact 类型的展示标签；缺省直接首字母大写。 */
export const ARTIFACT_TYPE_LABEL: Record<ArtifactType, string> = {
  document: 'Document',
  markdown: 'Markdown',
  code: 'Code',
  patch: 'Patch',
  diff: 'Diff',
  plan: 'Plan',
  report: 'Report',
  image: 'Image',
  html: 'HTML',
  json: 'JSON',
  csv: 'CSV',
  log: 'Log',
  'test-result': 'Test Result',
  'build-result': 'Build Result',
  'generated-file': 'Generated'
}

/**
 * 搜索过滤：命中组名（任务 / 会话标题）保留整组；否则只保留匹配的条目并重算计数。
 * 匹配范围：Artifact Name / Type / Path + 组名。
 */
export function filterArtifactGroups(groups: ArtifactGroup[], keyword: string): ArtifactGroup[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return groups
  const result: ArtifactGroup[] = []
  for (const group of groups) {
    if (group.name.toLowerCase().includes(kw)) {
      result.push(group)
      continue
    }
    const matched = group.artifacts.filter((artifact) =>
      artifact.name.toLowerCase().includes(kw)
      || artifact.type.toLowerCase().includes(kw)
      || (artifact.path ?? '').toLowerCase().includes(kw))
    if (matched.length) result.push({ ...group, count: matched.length, artifacts: matched })
  }
  return result
}

/** 时间戳 → 面板展示：今天显示时刻，更早显示日期。 */
export function formatArtifactTime(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
