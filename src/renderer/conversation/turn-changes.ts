import type { AgentFileChange, AgentRunChanges, FileOperation, TurnRevertResult } from '../../shared/types'

/** 路径拆成目录与文件名：卡片里目录用浅色、文件名用正文色，扫一眼先看到改的是哪个文件。 */
export function splitPath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf('/')
  return index < 0 ? { dir: '', name: path } : { dir: path.slice(0, index + 1), name: path.slice(index + 1) }
}

/**
 * 卡片内的排序：按状态分组（新增 → 修改 → 重命名 → 删除），组内按路径。
 * 台账按写入时间倒序给，适合「刚刚在改哪个」，但回看一轮改了什么要的是稳定顺序。
 */
const OPERATION_ORDER: Record<FileOperation, number> = { create: 0, update: 1, rename: 2, delete: 3 }

export function sortForList(files: AgentFileChange[]): AgentFileChange[] {
  return [...files].sort((a, b) => (OPERATION_ORDER[a.operation] - OPERATION_ORDER[b.operation]) || a.path.localeCompare(b.path))
}

/** 行尾的状态小标：修改是常态不标，只标新建、删除、重命名和已撤销。 */
export function fileTag(file: AgentFileChange): string {
  if (file.reverted) return '已撤销'
  if (file.operation === 'create') return '新建'
  if (file.operation === 'delete') return '删除'
  if (file.operation === 'rename') return '重命名'
  return ''
}

/** 还有没撤销的文件，撤销入口才出现。 */
export function canRevertTurn(changes: AgentRunChanges): boolean {
  return changes.files.some((file) => !file.reverted)
}

export function turnChangesTitle(changes: AgentRunChanges): string {
  const total = changes.files.length
  return canRevertTurn(changes) ? `已编辑 ${total} 个文件` : `已撤销 ${total} 个文件的修改`
}

/** 撤销确认框正文：说清楚每类文件会被怎么处理，删除是真删。 */
export function revertConfirmLines(changes: AgentRunChanges): string[] {
  const pending = changes.files.filter((file) => !file.reverted)
  const count = (operation: FileOperation) => pending.filter((file) => file.operation === operation).length
  const parts = [
    count('update') ? `${count('update')} 个修改的文件写回改动前的内容` : '',
    count('create') ? `${count('create')} 个新建的文件会被删除` : '',
    count('delete') ? `${count('delete')} 个被删的文件会恢复` : ''
  ].filter(Boolean)
  return [
    `把这一轮对 ${pending.length} 个文件的改动退回去：${parts.join('，') || '逐个恢复到改动前'}。`,
    '之后又被改过的文件会跳过，不会覆盖你的修改。'
  ]
}

/** 撤销完成后的提示；有跳过的列出前两个原因，其余只报数量。 */
export function revertNotice(result: TurnRevertResult): string {
  if (!result.skipped.length) return result.reverted.length ? `已撤销 ${result.reverted.length} 个文件` : '没有需要撤销的文件'
  const detail = result.skipped.slice(0, 2).map((item) => `${splitPath(item.path).name}（${item.reason}）`).join('、')
  const more = result.skipped.length > 2 ? ` 等 ${result.skipped.length} 个` : ''
  return `已撤销 ${result.reverted.length} 个文件，${detail}${more}未撤销`
}
