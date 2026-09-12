import type { AgentFileChange, AgentRunChanges, FileOperation } from '../../shared/types'

export const EMPTY_RUN_CHANGES: AgentRunChanges = {
  turnId: '',
  changedFiles: 0,
  addedFiles: 0,
  modifiedFiles: 0,
  deletedFiles: 0,
  renamedFiles: 0,
  additions: 0,
  deletions: 0,
  files: []
}

/** 文件状态的单字母标记，与 git 的 A/M/D/R 对齐。 */
export const OPERATION_MARK: Record<FileOperation, string> = {
  create: 'A',
  update: 'M',
  delete: 'D',
  rename: 'R'
}

export const OPERATION_LABEL: Record<FileOperation, string> = {
  create: 'Added',
  update: 'Modified',
  delete: 'Deleted',
  rename: 'Renamed'
}

/**
 * Run Bar 的可见性：执行中整条不出现——本轮进度已经由执行轨迹在讲，
 * 这里再挂一条 Working 只是重复噪音，还会在改动数变化时把输入框往上顶。
 * 终态且确有文件改动才显示。
 */
export function shouldShowRunBar(input: { turnId: string | null; running: boolean; changedFiles: number }): boolean {
  return Boolean(input.turnId) && !input.running && input.changedFiles > 0
}

/** 主 Bar 的主文案：`6 files` / `No changes`；执行中同样只报数量，正在改哪个单独一段。 */
export function runBarLabel(changes: AgentRunChanges, running: boolean): string {
  if (!changes.changedFiles) return running ? 'Working' : 'No changes'
  return `${changes.changedFiles} ${changes.changedFiles === 1 ? 'file' : 'files'}`
}

/** 执行中提示当前落笔的文件；取最近一次变更，没有则空。 */
export function currentFileLabel(changes: AgentRunChanges): string {
  const current = changes.files[0]
  return current ? `Editing ${fileName(current.path)}` : ''
}

/** `2 added · 3 modified · 1 deleted`；只列非零项，全零时返回空串。 */
export function compositionLabel(changes: AgentRunChanges): string {
  const parts: string[] = []
  if (changes.addedFiles) parts.push(`${changes.addedFiles} added`)
  if (changes.modifiedFiles) parts.push(`${changes.modifiedFiles} modified`)
  if (changes.deletedFiles) parts.push(`${changes.deletedFiles} deleted`)
  if (changes.renamedFiles) parts.push(`${changes.renamedFiles} renamed`)
  return parts.join(' · ')
}

export function fileName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path
}

/**
 * 展开层的排序：按状态分组（新增 → 修改 → 重命名 → 删除），组内按路径。
 * 主 Bar 要的是「刚刚在改哪个」，列表要的是「本轮整体改了什么」，两种顺序不能共用一份。
 */
const OPERATION_ORDER: Record<FileOperation, number> = { create: 0, update: 1, rename: 2, delete: 3 }

export function sortForList(files: AgentFileChange[]): AgentFileChange[] {
  return [...files].sort((a, b) => (OPERATION_ORDER[a.operation] - OPERATION_ORDER[b.operation]) || a.path.localeCompare(b.path))
}
