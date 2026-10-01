import type { TurnContextSource, TurnContextSourceKind } from '../../shared/types'

export interface ContextSourceGroup {
  kind: TurnContextSourceKind
  label: string
  /** 整组共用的一句说明；逐条重复会把清单撑成一大片同样的文字。 */
  note: string | null
  items: TurnContextSource[]
}

/** 固定顺序：知识与规则是本轮真正读进去的内容，Skill 只是候选，排在后面。 */
const GROUP_ORDER: Array<{ kind: TurnContextSourceKind; label: string; note: string | null }> = [
  { kind: 'kb', label: '项目知识', note: null },
  { kind: 'rule', label: '项目规则', note: null },
  { kind: 'skill', label: '可选中的 Skill', note: '只注入了名称与描述，正文由模型按需读取；点条目去能力页看正文' }
]

/** Skill 组常常有几十条，默认只露出前几条，其余折在「展开全部」后面。 */
export const CONTEXT_GROUP_PREVIEW = 6

export function groupContextSources(sources: readonly TurnContextSource[]): ContextSourceGroup[] {
  return GROUP_ORDER
    .map(({ kind, label, note }) => ({ kind, label, note, items: sources.filter((source) => source.kind === kind) }))
    .filter((group) => group.items.length > 0)
}

/** 组内可见条目；展开后给全量，折叠时截断到 CONTEXT_GROUP_PREVIEW。 */
export function visibleGroupItems(items: readonly TurnContextSource[], expanded: boolean, limit = CONTEXT_GROUP_PREVIEW): TurnContextSource[] {
  return expanded || items.length <= limit ? [...items] : items.slice(0, limit)
}

/** 折叠态的一行摘要；没有来源时返回空串，由调用方决定是否还渲染。 */
export function summarizeContextSources(sources: readonly TurnContextSource[]): string {
  return groupContextSources(sources).map((group) => `${group.label} ${group.items.length}`).join(' · ')
}

/** 只有落在磁盘上的来源能「打开」；知识条目存在库里，没有可打开的路径。 */
export function canOpenSource(source: TurnContextSource): boolean {
  return Boolean(source.locator)
}
