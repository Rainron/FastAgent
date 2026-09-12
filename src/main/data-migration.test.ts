import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveAppPaths } from './app-paths'
import { migrateLegacyData } from './data-migration'

const roots: string[] = []

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-migration-'))
  roots.push(root)
  const home = join(root, 'home')
  const userData = join(root, 'user-data')
  mkdirSync(userData, { recursive: true })
  return { root, paths: resolveAppPaths({ home, userData, cache: join(root, 'cache'), logs: join(root, 'logs'), temp: join(root, 'temp') }) }
}

function createDatabase(path: string, value: string) {
  const db = new Database(path)
  db.exec('CREATE TABLE marker(value TEXT NOT NULL)')
  db.prepare('INSERT INTO marker(value) VALUES (?)').run(value)
  db.close()
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('legacy data migration', () => {
  it('迁移旧数据库、会话和 agent 文件并保留旧目录', () => {
    const { paths } = setup()
    createDatabase(paths.legacyDatabasePath, 'legacy')
    mkdirSync(join(paths.legacySessionsDir, 'account'), { recursive: true })
    writeFileSync(join(paths.legacySessionsDir, 'account', 'session.jsonl'), '{"type":"session"}\n', 'utf8')
    mkdirSync(paths.legacyAgentDir, { recursive: true })
    writeFileSync(join(paths.legacyAgentDir, 'settings.json'), '{}\n', 'utf8')

    const result = migrateLegacyData(paths)

    expect(result.status).toBe('migrated')
    const migrated = new Database(paths.databasePath, { readonly: true })
    expect(migrated.prepare('SELECT value FROM marker').pluck().get()).toBe('legacy')
    migrated.close()
    expect(readFileSync(join(paths.sessionsDir, 'account', 'session.jsonl'), 'utf8')).toContain('session')
    expect(readFileSync(join(paths.agentDir, 'settings.json'), 'utf8')).toContain('{}')
    expect(existsSync(paths.legacyDatabasePath)).toBe(true)
    expect(existsSync(join(paths.dataDir, 'legacy-migration.json'))).toBe(true)
  })

  it('重复执行幂等且不覆盖已经存在的新数据库', () => {
    const { paths } = setup()
    createDatabase(paths.legacyDatabasePath, 'legacy')
    mkdirSync(paths.dataDir, { recursive: true })
    createDatabase(paths.databasePath, 'current')

    const first = migrateLegacyData(paths)
    const second = migrateLegacyData(paths)
    const db = new Database(paths.databasePath, { readonly: true })
    const value = db.prepare('SELECT value FROM marker').pluck().get()
    db.close()

    expect(first.status).toBe('adopted-current')
    expect(second.status).toBe('not-needed')
    expect(value).toBe('current')
  })

  it('没有旧数据时只创建目录', () => {
    const { paths } = setup()
    const result = migrateLegacyData(paths)
    expect(result.status).toBe('not-needed')
    expect(existsSync(paths.dataDir)).toBe(true)
    expect(existsSync(paths.sessionsDir)).toBe(true)
  })
})
