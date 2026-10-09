import type { GitCommitFile, GitFileChange } from '../../shared/types'
import { statusText } from './git-view'

/**
 * 未提交改动的三种组织方式：平铺文件、目录树、按改动类型分组。
 * git 给回来的永远是扁平路径列表，树结构在这里现算——没有必要为它加一条 IPC。
 */

export type ChangeViewMode = 'file' | 'folder' | 'status'

/**
 * 建树只需要路径与增删数，所以按 GitCommitFile 声明：
 * 未提交改动（GitFileChange）和提交详情（GitCommitFile）共用同一套树逻辑。
 */
export interface ChangeTreeNode {
  kind: 'dir' | 'file'
  /** 仓库相对路径；目录节点取它自己的完整路径 */
  path: string
  /** 展示名；压缩过的目录是 `src/main/java` 这种多段名 */
  name: string
  children: ChangeTreeNode[]
  file?: GitCommitFile
}

export interface ChangeRow {
  kind: 'dir' | 'file'
  path: string
  name: string
  depth: number
  /** 该节点覆盖的全部文件路径；目录行的批量操作和三态勾选都按它算 */
  paths: string[]
  /** 目录行汇总，文件行就是它自己的数值 */
  additions: number
  deletions: number
  file?: GitCommitFile
}

/** 目录在前、文件在后，同类按名称排；和文件管理器的直觉一致 */
function compareNodes(a: ChangeTreeNode, b: ChangeTreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name)
}

/** 按路径分段建树；重命名的 `a -> b` 这类路径 git 已经拆好，这里只认 `/`。 */
export function buildChangeTree(files: GitCommitFile[]): ChangeTreeNode[] {
  const root: ChangeTreeNode = { kind: 'dir', path: '', name: '', children: [] }
  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean)
    if (!segments.length) continue
    let parent = root
    for (let index = 0; index < segments.length - 1; index += 1) {
      const path = segments.slice(0, index + 1).join('/')
      let next = parent.children.find((node) => node.kind === 'dir' && node.path === path)
      if (!next) {
        next = { kind: 'dir', path, name: segments[index], children: [] }
        parent.children.push(next)
      }
      parent = next
    }
    parent.children.push({ kind: 'file', path: file.path, name: segments[segments.length - 1], children: [], file })
  }
  const sort = (node: ChangeTreeNode) => {
    node.children.sort(compareNodes)
    for (const child of node.children) if (child.kind === 'dir') sort(child)
  }
  sort(root)
  return root.children
}

/**
 * 只有一个子目录的目录并成一行（`src` + `main` → `src/main`）。
 * 侧栏只有几百像素宽，不压缩的话深层项目会把缩进吃光，每行只剩一两个字。
 */
export function compressSingleChildDirs(nodes: ChangeTreeNode[]): ChangeTreeNode[] {
  return nodes.map((node) => {
    if (node.kind !== 'dir') return node
    let current = node
    while (current.children.length === 1 && current.children[0].kind === 'dir') {
      const only = current.children[0]
      current = { kind: 'dir', path: only.path, name: `${current.name}/${only.name}`, children: only.children }
    }
    return { ...current, children: compressSingleChildDirs(current.children) }
  })
}

function collectFiles(node: ChangeTreeNode, into: ChangeRow[]): void {
  if (node.kind === 'file' && node.file) into.push({
    kind: 'file', path: node.path, name: node.name, depth: 0, paths: [node.path],
    additions: node.file.additions, deletions: node.file.deletions, file: node.file
  })
  for (const child of node.children) collectFiles(child, into)
}

/** 节点覆盖的文件与增删汇总，目录行的角标与批量操作都用它 */
function summarize(node: ChangeTreeNode): { paths: string[]; additions: number; deletions: number } {
  const files: ChangeRow[] = []
  collectFiles(node, files)
  return {
    paths: files.map((row) => row.path),
    additions: files.reduce((total, row) => total + row.additions, 0),
    deletions: files.reduce((total, row) => total + row.deletions, 0)
  }
}

/**
 * 按折叠集把树展平成可见行。存折叠而不是存展开：新出现的目录默认是展开的，
 * 不会因为没记录过就整棵收起来。
 */
export function flattenChangeRows(nodes: ChangeTreeNode[], collapsed: ReadonlySet<string>): ChangeRow[] {
  const rows: ChangeRow[] = []
  const visit = (list: ChangeTreeNode[], depth: number) => {
    for (const node of list) {
      if (node.kind === 'file' && node.file) {
        rows.push({
          kind: 'file', path: node.path, name: node.name, depth, paths: [node.path],
          additions: node.file.additions, deletions: node.file.deletions, file: node.file
        })
        continue
      }
      const summary = summarize(node)
      rows.push({ kind: 'dir', path: node.path, name: node.name, depth, ...summary })
      if (!collapsed.has(node.path)) visit(node.children, depth + 1)
    }
  }
  visit(nodes, 0)
  return rows
}

/** 平铺模式的行：保持 git 给的顺序，只补齐 ChangeRow 的形状 */
export function flatChangeRows(files: GitCommitFile[]): ChangeRow[] {
  return files.map((file) => ({
    kind: 'file' as const, path: file.path, name: file.path, depth: 0, paths: [file.path],
    additions: file.additions, deletions: file.deletions, file
  }))
}

export interface ChangeStatusGroup {
  /** 归一化后的单字符状态码，未跟踪统一成 `?` */
  code: string
  label: string
  rows: ChangeRow[]
}

/** 冲突最该先看见，其次是新增/修改/删除这类日常改动 */
const STATUS_ORDER = ['U', '?', 'A', 'M', 'D', 'R', 'C', 'T']

function statusCode(file: GitFileChange): string {
  if (file.untracked) return '?'
  return file.status.trim().slice(0, 1) || '?'
}

/** 按改动类型分组；组内保持 git 的原始顺序，组间按 STATUS_ORDER 排，未知码排最后。 */
export function groupChangesByStatus(files: GitFileChange[]): ChangeStatusGroup[] {
  const groups = new Map<string, ChangeRow[]>()
  for (const row of flatChangeRows(files)) {
    const code = statusCode(row.file as GitFileChange)
    const bucket = groups.get(code)
    if (bucket) bucket.push(row)
    else groups.set(code, [row])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const left = STATUS_ORDER.indexOf(a)
      const right = STATUS_ORDER.indexOf(b)
      return (left === -1 ? STATUS_ORDER.length : left) - (right === -1 ? STATUS_ORDER.length : right)
    })
    .map(([code, rows]) => ({ code, label: statusText(code), rows }))
}

/**
 * 未暂存的改动再按是否纳入版本管理拆开。
 * git status 把两者混在一起给，但它们的心智完全不同：已跟踪文件是「改了什么」，
 * 未纳管文件里大多是产物和临时文件，混在一条列表里会把真正的改动淹掉。
 */
export function splitUnversioned(files: GitFileChange[]): { modified: GitFileChange[]; unversioned: GitFileChange[] } {
  const modified: GitFileChange[] = []
  const unversioned: GitFileChange[] = []
  for (const file of files) (file.untracked ? unversioned : modified).push(file)
  return { modified, unversioned }
}

/** 目录行勾选框的三态：全选 / 部分 / 未选 */
export function pathsSelectionState(paths: string[], selected: ReadonlySet<string>): 'all' | 'partial' | 'none' {
  if (!paths.length) return 'none'
  let hit = 0
  for (const path of paths) if (selected.has(path)) hit += 1
  if (hit === 0) return 'none'
  return hit === paths.length ? 'all' : 'partial'
}

/** 目录行点勾选：已经全选就整组取消，否则整组选上 */
export function togglePaths(selected: ReadonlySet<string>, paths: string[]): Set<string> {
  const next = new Set(selected)
  if (pathsSelectionState(paths, selected) === 'all') for (const path of paths) next.delete(path)
  else for (const path of paths) next.add(path)
  return next
}

/** 折叠集开关；目录路径唯一，直接按存在与否翻转 */
export function toggleCollapsed(collapsed: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(collapsed)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}
