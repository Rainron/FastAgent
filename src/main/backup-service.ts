import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface BackupHandle {
  backupPath: string
}

function dateKey(now: Date) {
  return now.toISOString().slice(0, 10)
}

/** 同一天重复调用返回同一备份路径，避免启动多次产生重复副本。 */
export function createDailyBackup(options: { backupsDir: string; databasePath: string; now?: Date }): BackupHandle {
  mkdirSync(options.backupsDir, { recursive: true })
  const key = dateKey(options.now ?? new Date())
  const markerPath = join(options.backupsDir, 'latest-backup-day')
  const backupPath = join(options.backupsDir, `fastagent-${key}.db`)
  if (existsSync(markerPath) && readFileSync(markerPath, 'utf8') === key && existsSync(backupPath)) return { backupPath }
  copyFileSync(options.databasePath, backupPath)
  writeFileSync(markerPath, key, 'utf8')
  return { backupPath }
}

const DAILY_BACKUP = /^fastagent-\d{4}-\d{2}-\d{2}\.db$/
const SIDECAR_SUFFIX = /-(shm|wal)$/

/**
 * 保留最近 N 份备份，返回被清理的文件名。
 * 除了过期的每日备份，还要收掉 -shm / -wal 边车：这两个文件由「谁打开过备份库」留下，
 * 主文件删了它们不会跟着走，一份 -shm 就是 32KB，孤儿攒着只增不减。
 */
export function pruneBackups(backupsDir: string, keep: number): string[] {
  const entries = readdirSync(backupsDir)
  const expired = entries.filter((name) => DAILY_BACKUP.test(name)).sort().reverse().slice(keep)
  const survivors = new Set(entries.filter((name) => name.endsWith('.db') && !expired.includes(name)))
  // 主文件已不存在的边车同样清掉，包括历史上手工备份留下的那批。
  const orphanSidecars = entries.filter((name) => SIDECAR_SUFFIX.test(name) && !survivors.has(name.replace(SIDECAR_SUFFIX, '')))
  const removed: string[] = []
  for (const name of [...expired, ...orphanSidecars]) {
    rmSync(join(backupsDir, name), { force: true })
    removed.push(name)
  }
  return removed
}