/**
 * 模型 id 的前缀分组。厂商返回的清单常常是同一系列的一大串
 * （gpt-4o / gpt-4o-mini / gpt-5…），按前缀折成一层树才挑得动。
 */
export interface ModelPrefixGroup<T> {
  /** 组名；无法归组的单个模型用空串，界面上按平铺行渲染。 */
  prefix: string
  items: T[]
}

/** OpenRouter 这类带命名空间的 id 按命名空间归组，其余按第一个分隔符前的词。 */
export function modelPrefix(id: string): string {
  const value = id.trim()
  if (!value) return ''
  const namespace = value.indexOf('/')
  if (namespace > 0) return value.slice(0, namespace)
  const token = value.split(/[-_:.@]/)[0]
  return token.length >= 2 && token !== value ? token : ''
}

export function groupByModelPrefix<T extends { id: string }>(items: T[]): Array<ModelPrefixGroup<T>> {
  const groups: Array<ModelPrefixGroup<T>> = []
  const index = new Map<string, ModelPrefixGroup<T>>()
  for (const item of items) {
    const prefix = modelPrefix(item.id)
    const existing = prefix ? index.get(prefix) : undefined
    if (existing) { existing.items.push(item); continue }
    const group: ModelPrefixGroup<T> = { prefix, items: [item] }
    groups.push(group)
    if (prefix) index.set(prefix, group)
  }
  // 只出现一次的前缀不值得占一层，拍平成普通行。
  return groups.map((group) => group.items.length > 1 ? group : { prefix: '', items: group.items })
}
