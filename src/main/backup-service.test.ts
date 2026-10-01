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

  it('轮换过期备份时连带删掉它的 -shm / -wal 边车', () => {
    const { backupsDir, dataDir } = setup()
    createDailyBackup({ backupsDir, databasePath: join(dataDir, 'fastagent.db'), now: new Date('2026-08-30T10:00:00Z') })
    createDailyBackup({ backupsDir, databasePath: join(dataDir, 'fastagent.db'), now: new Date('2026-08-31T10:00:00Z') })
    writeFileSync(join(backupsDir, 'fastagent-2026-08-30.db-shm'), 'x', 'utf8')
    writeFileSync(join(backupsDir, 'fastagent-2026-08-30.db-wal'), 'x', 'utf8')
    // 仍被保留的那份，边车不能动
    writeFileSync(join(backupsDir, 'fastagent-2026-08-31.db-wal'), 'x', 'utf8')

    const pruned = pruneBackups(backupsDir, 1)
    expect(pruned.sort()).toEqual(['fastagent-2026-08-30.db', 'fastagent-2026-08-30.db-shm', 'fastagent-2026-08-30.db-wal'])
    expect(readdirSync(backupsDir).sort()).toEqual(['fastagent-2026-08-31.db', 'fastagent-2026-08-31.db-wal', 'latest-backup-day'])
  })

  it('主文件已不存在的孤儿边车一并清掉', () => {
    const { backupsDir, dataDir } = setup()
    createDailyBackup({ backupsDir, databasePath: join(dataDir, 'fastagent.db'), now: new Date('2026-08-30T10:00:00Z') })
    writeFileSync(join(backupsDir, 'fastagent-before-activity-strip-2026-09-04.db-shm'), 'x', 'utf8')

    expect(pruneBackups(backupsDir, 14)).toEqual(['fastagent-before-activity-strip-2026-09-04.db-shm'])
  })

  it('同一天重复备份返回同一路径', () => {
    const { backupsDir, dataDir } = setup()
    const first = createDailyBackup({ backupsDir, databasePath: join(dataDir, 'fastagent.db'), now: new Date('2026-08-30T10:00:00Z') })
    writeFileSync(first.backupPath, 'x', 'utf8')
    const second = createDailyBackup({ backupsDir, databasePath: join(dataDir, 'fastagent.db'), now: new Date('2026-08-30T18:00:00Z') })
    expect(second.backupPath).toBe(first.backupPath)
  })
})