import type { TurnContextSource, TurnContextSourceKind } from '../../shared/types'

export interface ContextSourceGroup {
  kind: TurnContextSourceKind
  label: string
  items: TurnContextSource[]
}

/** 固定顺序：知识与规则是本轮真正读进去的内容，Skill 只是候选，排在后面。 */
const GROUP_ORDER: Array<{ kind: TurnContextSourceKind; label: string }> = [
  { kind: 'kb', label: '项目知识' },
  { kind: 'rule', label: '项目规则' },
  { kind: 'skill', label: '可选中的 Skill' }
]

export function groupContextSources(sources: readonly TurnContextSource[]): ContextSourceGroup[] {
  return GROUP_ORDER
    .map(({ kind, label }) => ({ kind, label, items: sources.filter((source) => source.kind === kind) }))
    .filter((group) => group.items.length > 0)
}

/** 折叠态的一行摘要；没有来源时返回空串，由调用方决定是否还渲染。 */
export function summarizeContextSources(sources: readonly TurnContextSource[]): string {
  return groupContextSources(sources).map((group) => `${group.label} ${group.items.length}`).join(' · ')
}

/** 只有落在磁盘上的来源能「打开」；知识条目存在库里，没有可打开的路径。 */
export function canOpenSource(source: TurnContextSource): boolean {
  return Boolean(source.locator)
}
