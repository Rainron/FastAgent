/**
 * 页内查找的纯逻辑：文本内命中定位与命中序号导航。
 * DOM 遍历留在组件里，这里保持无 DOM 依赖以便单测。
 */

export interface TextOccurrence {
  start: number
  end: number
}

/**
 * 找出全部命中区间；默认大小写不敏感。
 * 命中不重叠：「aaa」查「aa」只得到一处，与浏览器查找条一致。
 */
export function findOccurrences(text: string, query: string, options?: { caseSensitive?: boolean }): TextOccurrence[] {
  const caseSensitive = options?.caseSensitive ?? false
  const needle = caseSensitive ? query : query.toLowerCase()
  if (!needle) return []
  const haystack = caseSensitive ? text : text.toLowerCase()
  const result: TextOccurrence[] = []
  let from = 0
  for (;;) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) return result
    result.push({ start: index, end: index + needle.length })
    from = index + needle.length
  }
}

/** 命中序号导航：越界回绕（Enter/Shift+Enter 连续翻页）；无命中时恒为 0。 */
export function stepMatchIndex(index: number, delta: number, total: number): number {
  if (total <= 0) return 0
  return (((index + delta) % total) + total) % total
}
