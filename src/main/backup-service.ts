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

/** 保留最近 N 份备份，返回被清理的文件名。 */
export function pruneBackups(backupsDir: string, keep: number): string[] {
  const backups = readdirSync(backupsDir)
    .filter((name) => /^fastagent-\d{4}-\d{2}-\d{2}\.db$/.test(name))
    .sort()
    .reverse()
  const removed: string[] = []
  for (const name of backups.slice(keep)) {
    rmSync(join(backupsDir, name), { force: true })
    removed.push(name)
  }
  return removed
}