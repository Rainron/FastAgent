import type { Artifact, ArtifactGroup, ArtifactType } from './types'

/** 扩展名 → Artifact 类型的映射；无匹配时按文件是否文本进一步兜底。 */
const EXTENSION_TYPE_MAP: Record<string, ArtifactType> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  txt: 'document',
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  ppt: 'document',
  pptx: 'document',
  xls: 'document',
  xlsx: 'document',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  py: 'code',
  rb: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  kt: 'code',
  kts: 'code',
  scala: 'code',
  groovy: 'code',
  gradle: 'code',
  c: 'code',
  h: 'code',
  cc: 'code',
  cpp: 'code',
  hpp: 'code',
  cs: 'code',
  php: 'code',
  swift: 'code',
  m: 'code',
  mm: 'code',
  dart: 'code',
  lua: 'code',
  r: 'code',
  pl: 'code',
  sh: 'code',
  bash: 'code',
  ps1: 'code',
  bat: 'code',
  cmd: 'code',
  sql: 'code',
  css: 'code',
  scss: 'code',
  less: 'code',
  vue: 'code',
  svelte: 'code',
  patch: 'patch',
  diff: 'diff',
  html: 'html',
  htm: 'html',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  svg: 'image',
  ico: 'image',
  json: 'json',
  jsonc: 'json',
  csv: 'csv',
  tsv: 'csv',
  log: 'log',
  yml: 'generated-file',
  yaml: 'generated-file',
  toml: 'generated-file',
  ini: 'generated-file',
  cfg: 'generated-file',
  conf: 'generated-file',
  properties: 'generated-file',
  xml: 'generated-file',
  zip: 'generated-file',
  tar: 'generated-file',
  gz: 'generated-file'
}

/** 按文件名推断 Artifact 类型：先看名字特征（任务文件/报告/测试结果），再看扩展名。 */
export function inferArtifactType(name: string): ArtifactType {
  const base = name.toLowerCase()
  if (base.includes('task_plan') || base.includes('task-plan') || base.includes('todo')) return 'plan'
  if (base.includes('test-result') || base.includes('test_result') || base.includes('testresult') || base.includes('tests.')) return 'test-result'
  if (base.includes('build-result') || base.includes('build_result') || base.includes('buildresult')) return 'build-result'
  if (base.includes('report')) return 'report'
  const extension = base.split('.').pop() || ''
  return EXTENSION_TYPE_MAP[extension] ?? 'generated-file'
}

/** 同一工作区 + 同一路径 + 同一会话内多次写入视为同一 Artifact 的更新，避免重复登记。 */
export function artifactKey(workspaceId: string, path: string | undefined, conversationId: string | undefined): string {
  return `${workspaceId}\u0000${path ?? ''}\u0000${conversationId ?? ''}`
}

/** 无归属会话时自动生成的任务摘要标题：取来源（如写入工具）或文件名前缀。 */
export function autoTitle(artifact: Artifact): string {
  const fromSource = artifact.source ? artifact.source.trim() : ''
  if (fromSource) return fromSource.length > 24 ? `${fromSource.slice(0, 24)}…` : fromSource
  const base = artifact.name.replace(/\.(md|markdown|txt|json|log|diff|patch|html|csv)$/i, '').replace(/[_-]+/g, ' ').trim()
  return base || '未命名任务'
}

export interface ArtifactGroupOptions {
  /** 按会话 id 查标题；返回 null 时回落为自动生成。 */
  titleForConversation?: (conversationId: string) => string | null
  /** 最多返回多少组；超出部分并入超限组（缺省不限制）。 */
  limit?: number
  /** 当前会话：无论时间新旧都排在最前，用户刚产出的东西不该被历史挤下去。 */
  pinnedConversationId?: string | null
}

/**
 * 把 Artifact 列表按会话（任务）分组，供 Artifacts 面板树使用。
 * 分组规则：有 conversationId 的按会话分组（组名 = 任务名 → 会话标题 → 自动生成），
 * 无归属的进 Ungrouped 兜底；组间按最新条目时间降序，Ungrouped 恒排最后。
 */
export function buildArtifactGroups(artifacts: Artifact[], options: ArtifactGroupOptions = {}): ArtifactGroup[] {
  const byConversation = new Map<string, Artifact[]>()
  const ungrouped: Artifact[] = []
  for (const artifact of artifacts) {
    if (artifact.conversationId) {
      const list = byConversation.get(artifact.conversationId)
      if (list) list.push(artifact)
      else byConversation.set(artifact.conversationId, [artifact])
    } else {
      ungrouped.push(artifact)
    }
  }
  const sortByNewest = (a: Artifact, b: Artifact) => b.updatedAt - a.updatedAt
  const groups: ArtifactGroup[] = []
  for (const [conversationId, items] of byConversation) {
    items.sort(sortByNewest)
    const groupTitle = options.titleForConversation?.(conversationId)?.trim() || autoTitle(items[0])
    groups.push({ id: conversationId, name: groupTitle, count: items.length, artifacts: items })
  }
  const pinned = options.pinnedConversationId
  groups.sort((a, b) => {
    if (pinned && a.id !== b.id) {
      if (a.id === pinned) return -1
      if (b.id === pinned) return 1
    }
    return (b.artifacts[0]?.updatedAt ?? 0) - (a.artifacts[0]?.updatedAt ?? 0)
  })
  if (ungrouped.length) {
    ungrouped.sort(sortByNewest)
    groups.push({ id: 'ungrouped', name: 'Ungrouped', count: ungrouped.length, artifacts: ungrouped })
  }
  if (!options.limit || groups.length <= options.limit) return groups
  // 超出限制时把最旧的多余组并成「更多」组，保证面板不会无限拉长。
  const kept = groups.slice(0, options.limit)
  const rest = groups.slice(options.limit)
  const restCount = rest.reduce((sum, group) => sum + group.count, 0)
  kept.push({ id: 'more', name: '更多任务', count: restCount, artifacts: rest.flatMap((group) => group.artifacts) })
  return kept
}

/** 生成新 Artifact 的 id；带时间前缀便于按创建顺序排序。 */
export function createArtifactId(): string {
  return `artifact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
