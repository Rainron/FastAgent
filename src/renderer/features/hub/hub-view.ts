import type { HubSource, HubSourceFailure, HubSourceKind, HubSourceStatus } from '../../../shared/types'
import type { StatusPresentation } from '../abilities/ability-view'

export const SOURCE_KIND_LABELS: Record<HubSourceKind, string> = {
  builtin: '内置目录',
  git: 'Git 仓库',
  skillsmp: 'SkillsMP',
  'mcp-registry': 'MCP Registry'
}

const SOURCE_STATUS: Record<HubSourceStatus, StatusPresentation> = {
  untested: { label: '未测试', tone: 'muted' },
  ready: { label: '可用', tone: 'ok' },
  unreachable: { label: '连不上', tone: 'error' },
  unauthorized: { label: '未授权', tone: 'warn' }
}

export function sourceStatusPresentation(status: HubSourceStatus): StatusPresentation {
  return SOURCE_STATUS[status]
}

/** 尚未落地的源类型在界面上要提前说清楚，而不是等搜索完才报错。 */
export const SUPPORTED_SOURCE_KINDS: HubSourceKind[] = ['builtin', 'git', 'skillsmp', 'mcp-registry']

/** 只有 Git 源必须自己填地址；聚合站有默认 base URL，留空即可。 */
export const SOURCE_URL_PLACEHOLDERS: Record<HubSourceKind, string> = {
  builtin: '',
  git: 'https://github.com/owner/repo',
  skillsmp: '留空用 https://skillsmp.com',
  'mcp-registry': '留空用 https://registry.modelcontextprotocol.io'
}

export function isSourceSupported(kind: HubSourceKind) {
  return SUPPORTED_SOURCE_KINDS.includes(kind)
}

export interface SourceDraft {
  id: string
  kind: HubSourceKind
  name: string
  url: string
  ref: string
  apiKey: string
}

export function emptySourceDraft(): SourceDraft {
  return { id: '', kind: 'git', name: '', url: '', ref: '', apiKey: '' }
}

export function draftFromSource(source: HubSource): SourceDraft {
  return { id: source.id, kind: source.kind, name: source.name, url: source.url ?? '', ref: source.ref ?? '', apiKey: '' }
}

/**
 * id 用作主键与 pluginId 前缀，落库前收敛掉路径与 URL 敏感字符。
 * 保留 Unicode 字母数字：只留 ASCII 的话，中文源名会被整段抹成空串，用户还得再手填一个 id。
 */
export function normalizeSourceId(value: string) {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '')
}

/** 返回首个阻塞保存的原因；为 null 表示可以保存。 */
export function validateSourceDraft(draft: SourceDraft, existingIds: string[]): string | null {
  const id = normalizeSourceId(draft.id || draft.name)
  if (!id) return '请填写源名称'
  if (existingIds.includes(id)) return `已存在同名源：${id}`
  if (!draft.name.trim()) return '请填写源名称'
  if (draft.kind === 'git' && !draft.url.trim()) return '请填写仓库地址'
  if (draft.kind !== 'builtin' && draft.url.trim()) {
    try {
      const url = new URL(draft.url.trim())
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '地址必须是 http 或 https'
    } catch {
      return '地址不是合法 URL'
    }
  }
  return null
}

/** 一次搜索里失败的源要在结果上方明说，否则用户只会看到「结果变少了」。 */
export function failureSummary(failures: HubSourceFailure[], sources: HubSource[]): string | null {
  if (!failures.length) return null
  const named = failures.map((failure) => {
    const name = sources.find((source) => source.id === failure.sourceId)?.name ?? failure.sourceId
    return `${name}（${failure.message}）`
  })
  return `${named.length} 个源没有返回结果：${named.join('；')}`
}
