import type { ShellCommandStatus } from '../../shared/types'

/** 输入框 `!命令` 的一次执行。只活在当前界面里，不落库。 */
export interface ShellCommandEntry {
  id: string
  command: string
  /** 执行时会话里最后一个回合；null 表示排在所有回合之前 */
  anchorTurnId: string | null
  output: string
  status: 'running' | ShellCommandStatus
  exitCode: number | null
  error: string | null
  truncated: boolean
  cwd: string
  startedAt: number
  finishedAt: number | null
}

export interface GroupedShellEntries {
  /** 会话还没有任何回合时执行的命令 */
  leading: ShellCommandEntry[]
  byTurnId: Record<string, ShellCommandEntry[]>
}

const EMPTY: GroupedShellEntries = { leading: [], byTurnId: {} }

/**
 * 按锚点回合分组，让命令卡片插回它当时所在的位置。
 * 锚点回合已被删除时退回列表末尾，卡片不能因为删了一轮问答就消失。
 */
export function groupShellEntries(entries: readonly ShellCommandEntry[], turnIds: readonly string[]): GroupedShellEntries {
  if (entries.length === 0) return EMPTY
  const known = new Set(turnIds)
  const lastTurnId = turnIds.length ? turnIds[turnIds.length - 1] : null
  const grouped: GroupedShellEntries = { leading: [], byTurnId: {} }
  for (const entry of entries) {
    const anchor = entry.anchorTurnId === null || known.has(entry.anchorTurnId) ? entry.anchorTurnId : lastTurnId
    if (!anchor) { grouped.leading.push(entry); continue }
    const bucket = grouped.byTurnId[anchor] ?? (grouped.byTurnId[anchor] = [])
    bucket.push(entry)
  }
  return grouped
}

/**
 * 重跑第 N 轮时清掉排在它之后的命令卡：锚在第 N 轮及之后回合上的命令都发生在旧回答之后。
 * 锚点回合已不存在的按排在末尾处理，一样清掉；还在跑的保留，否则就没有地方点停止了。
 */
export function dropShellEntriesFrom(entries: readonly ShellCommandEntry[], turnIds: readonly string[], fromTurnId: string): ShellCommandEntry[] {
  const from = turnIds.indexOf(fromTurnId)
  if (from < 0) return [...entries]
  return entries.filter((entry) => {
    if (entry.status === 'running' || entry.anchorTurnId === null) return true
    const index = turnIds.indexOf(entry.anchorTurnId)
    return index >= 0 && index < from
  })
}
