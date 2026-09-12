import type { WorkspaceEntry } from '../../shared/types'

export interface TreeRow {
  path: string
  name: string
  kind: 'dir' | 'file'
  depth: number
  size?: number
  fileType?: string
}

/** 每个目录的条目缓存；根目录用空串作键。 */
export type ChildrenByPath = ReadonlyMap<string, WorkspaceEntry[]>

/**
 * 把「目录 → 子条目」的懒加载缓存按展开集 DFS 展平成可见行。
 * 未加载的已展开目录只输出目录行本身（行尾给加载提示由组件处理）。
 */
export function flattenTreeRows(children: ChildrenByPath, expanded: ReadonlySet<string>, rootChildrenKey = ''): TreeRow[] {
  const rows: TreeRow[] = []
  const rootEntries = children.get(rootChildrenKey)
  if (!rootEntries) return rows
  const visit = (entries: WorkspaceEntry[], depth: number) => {
    for (const entry of entries) {
      rows.push({
        path: entry.path,
        name: entry.name,
        kind: entry.kind,
        depth,
        size: entry.size,
        fileType: entry.fileType
      })
      if (entry.kind === 'dir' && expanded.has(entry.path)) {
        const nested = children.get(entry.path)
        if (nested) visit(nested, depth + 1)
      }
    }
  }
  visit(rootEntries, 0)
  return rows
}

/** 关键字匹配文件名 / 目录名 / 相对路径；子序列与子串两种都认。 */
export function matchesTreeKeyword(path: string, name: string, keyword: string): boolean {
  const lowerKeyword = keyword.trim().toLowerCase()
  if (!lowerKeyword) return true
  if (name.toLowerCase().includes(lowerKeyword)) return true
  if (path.toLowerCase().includes(lowerKeyword)) return true
  // 子序列匹配：输入 apptsx 也能命中 src/App.tsx，与 @ 补全一致。
  let index = 0
  for (const char of lowerKeyword) {
    const found = path.toLowerCase().indexOf(char, index)
    if (found < 0) return false
    index = found + 1
  }
  return true
}
