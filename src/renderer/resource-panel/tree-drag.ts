import type { TreeSelectionItem } from './tree-selection'

/** 拖放移动的纯逻辑：落点判定与移动后的路径改写。根目录用空串表示。 */

export function parentPath(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

/** 放到文件行上等于放进它所在的目录，和 VS Code 资源管理器一致。 */
export function dropDirFor(item: TreeSelectionItem): string {
  return item.kind === 'dir' ? item.path : parentPath(item.path)
}

/**
 * 能不能放进 target：目录不能进自己或自己的子目录；所有项都已在 target 里时没有可做的事。
 * 主进程会逐项再判一次（含同名冲突），这里只挡掉明显无效的落点，不让它高亮。
 */
export function canDropInto(sources: TreeSelectionItem[], target: string): boolean {
  if (!sources.length) return false
  for (const source of sources) {
    if (source.path === '' || source.path === target) return false
    if (source.kind === 'dir' && target.startsWith(`${source.path}/`)) return false
  }
  return sources.some((source) => parentPath(source.path) !== target)
}

/** 移动后改写展开态、选中态里的路径：落在被移动项之下的一并换前缀。 */
export function remapMovedPath(path: string, moves: Array<{ from: string; to: string }>): string {
  for (const move of moves) {
    if (path === move.from) return move.to
    if (path.startsWith(`${move.from}/`)) return `${move.to}${path.slice(move.from.length)}`
  }
  return path
}
