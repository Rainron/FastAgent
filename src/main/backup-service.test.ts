import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDailyBackup, pruneBackups } from './backup-service'

const roots: string[] = []

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-backup-'))
  roots.push(root)
  const dataDir = join(root, 'data')
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(join(dataDir, 'fastagent.db'))
  db.exec('CREATE TABLE marker(value TEXT)')
  db.prepare('INSERT INTO marker(value) VALUES (?)').run('ok')
  db.close()
  return { root, backupsDir: join(root, 'backups'), dataDir }
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('backup service', () => {
  it('按天生成命名备份并轮换数量', () => {
    const { backupsDir, dataDir } = setup()
    const now = new Date('2026-08-30T10:00:00Z')
    const first = createDailyBackup({ backupsDir, databasePath: join(dataDir, 'fastagent.db'), now })
    const second = createDailyBackup({ backupsDir, databasePath: join(dataDir, 'fastagent.db'), now: new Date('2026-08-31T10:00:00Z') })

    expect(first.backupPath).toContain('2026-08-30')
    expect(second.backupPath).toContain('2026-08-31')
    expect(readdirSync(backupsDir).filter((name) => name.endsWith('.db'))).toHaveLength(2)

    const pruned = pruneBackups(backupsDir, 1)
    expect(pruned).toHaveLength(1)
    expect(readdirSync(backupsDir).filter((name) => name.endsWith('.db'))).toHaveLength(1)
  })

  it('同一天重复备份返回同一路径', () => {
    const { backupsDir, dataDir } = setup()
    const first = createDailyBackup({ backupsDir, databasePath: join(dataDir, 'fastagent.db'), now: new Date('2026-08-30T10:00:00Z') })
    writeFileSync(first.backupPath, 'x', 'utf8')
    const second = createDailyBackup({ backupsDir, databasePath: join(dataDir, 'fastagent.db'), now: new Date('2026-08-30T18:00:00Z') })
    expect(second.backupPath).toBe(first.backupPath)
  })
})