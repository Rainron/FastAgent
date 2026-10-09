/**
 * 资源树多选的纯逻辑：Ctrl/⌘ 单项切换、Shift 连续范围、批量操作前的去重与摘要。
 * 选中项按用户点选顺序保存；根目录（空串）不参与多选，整个工作区不该被一次批量操作带走。
 */
export interface TreeSelectionItem {
  path: string
  kind: 'dir' | 'file'
}

export function toggleSelection(selection: TreeSelectionItem[], item: TreeSelectionItem): TreeSelectionItem[] {
  if (item.path === '') return selection
  return selection.some((entry) => entry.path === item.path)
    ? selection.filter((entry) => entry.path !== item.path)
    : [...selection, item]
}

/**
 * Shift 点选：锚点到目标之间（含两端）按可见顺序全部选中。
 * 锚点已不在可见行里（折叠了目录、换了搜索词）时退化成只选目标。
 */
export function rangeSelection(order: TreeSelectionItem[], anchor: string | null, target: TreeSelectionItem): TreeSelectionItem[] {
  const to = order.findIndex((entry) => entry.path === target.path)
  const from = anchor === null ? -1 : order.findIndex((entry) => entry.path === anchor)
  if (to < 0 || from < 0) return target.path === '' ? [] : [target]
  const [low, high] = from <= to ? [from, to] : [to, from]
  return order.slice(low, high + 1).filter((entry) => entry.path !== '')
}

/**
 * 批量删除 / 复制前去掉已被祖先目录覆盖的项：目录删掉后再删它里面的文件只会报「不存在」。
 * 保持原顺序。
 */
export function topLevelSelection(selection: TreeSelectionItem[]): TreeSelectionItem[] {
  const dirs = selection.filter((entry) => entry.kind === 'dir').map((entry) => entry.path)
  return selection.filter((entry) => !dirs.some((dir) => dir !== entry.path && entry.path.startsWith(`${dir}/`)))
}

/** 操作栏摘要：「3 个文件 · 2 个目录」，只列非零项。 */
export function selectionSummary(selection: TreeSelectionItem[]): string {
  const files = selection.filter((entry) => entry.kind === 'file').length
  const dirs = selection.length - files
  return [files ? `${files} 个文件` : '', dirs ? `${dirs} 个目录` : ''].filter(Boolean).join(' · ')
}

/** 插入输入框的引用文本：与 @ 补全一致，插的是不带前缀的相对路径，末尾留空格方便接着输入。 */
export function selectionMentionText(selection: TreeSelectionItem[]): string {
  return `${selection.map((entry) => entry.path).join(' ')} `
}

export interface MarqueeRow extends TreeSelectionItem {
  /** 行在滚动内容坐标系里的上下边。 */
  top: number
  bottom: number
}

/** 框选命中：与纵向区间 [top, bottom] 有交叠的行，按行序；根目录不参与。 */
export function marqueeHits(rows: MarqueeRow[], top: number, bottom: number): TreeSelectionItem[] {
  return rows
    .filter((row) => row.path !== '' && row.bottom > top && row.top < bottom)
    .map((row) => ({ path: row.path, kind: row.kind }))
}

/** Ctrl 框选是在原有选择上追加：并集，保持先原有、后新增的顺序。 */
export function mergeSelection(base: TreeSelectionItem[], extra: TreeSelectionItem[]): TreeSelectionItem[] {
  const seen = new Set(base.map((entry) => entry.path))
  return [...base, ...extra.filter((entry) => !seen.has(entry.path))]
}
