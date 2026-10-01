import Database from 'better-sqlite3'
import { copyFileSync, cpSync, existsSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ensureAppDirectories, type AppPaths } from './app-paths'

export interface LegacyMigrationResult {
  status: 'migrated' | 'adopted-current' | 'not-needed'
}

function checkpointDatabase(path: string) {
  const db = new Database(path)
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
}

function verifyDatabase(path: string) {
  const db = new Database(path, { readonly: true })
  try {
    const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>
    if (!rows.length || rows.some((row) => row.integrity_check !== 'ok')) throw new Error('迁移后的数据库完整性检查失败')
  } finally {
    db.close()
  }
}

/**
 * 删临时库必须连 -shm / -wal 一起删：verifyDatabase 打开过它，SQLite 会在旁边建这两个文件，
 * 只 rm 主文件会把它们留成孤儿（历史上就在 data/ 下积了一对 .migrating-shm/-wal）。
 */
function removeDatabaseFiles(path: string) {
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true })
}

/** 清掉历史版本遗留的 *.migrating 及其边车文件；失败不影响启动。 */
export function sweepMigrationResidue(dataDir: string): string[] {
  if (!existsSync(dataDir)) return []
  const removed: string[] = []
  for (const name of readdirSync(dataDir)) {
    if (!/\.migrating(-shm|-wal)?$/.test(name)) continue
    rmSync(join(dataDir, name), { force: true })
    removed.push(name)
  }
  return removed
}

function copyTreeIfPresent(source: string, destination: string) {
  if (!existsSync(source)) return
  cpSync(source, destination, { recursive: true, force: false, errorOnExist: false })
}

function writeMigrationMarker(paths: AppPaths, status: LegacyMigrationResult['status']) {
  const markerPath = join(paths.dataDir, 'legacy-migration.json')
  const temporaryPath = `${markerPath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify({ schemaVersion: 1, status, completedAt: new Date().toISOString(), source: paths.platformUserDataDir }, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, markerPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function migrateLegacyData(paths: AppPaths): LegacyMigrationResult {
  ensureAppDirectories(paths)
  const markerPath = join(paths.dataDir, 'legacy-migration.json')
  if (existsSync(markerPath)) return { status: 'not-needed' }
  if (!existsSync(paths.legacyDatabasePath)) return { status: 'not-needed' }

  let status: LegacyMigrationResult['status'] = 'adopted-current'
  if (!existsSync(paths.databasePath)) {
    checkpointDatabase(paths.legacyDatabasePath)
    const temporaryDatabase = `${paths.databasePath}.${randomUUID()}.migrating`
    try {
      copyFileSync(paths.legacyDatabasePath, temporaryDatabase)
      verifyDatabase(temporaryDatabase)
      renameSync(temporaryDatabase, paths.databasePath)
    } finally {
      removeDatabaseFiles(temporaryDatabase)
    }
    status = 'migrated'
  }

  copyTreeIfPresent(paths.legacySessionsDir, paths.sessionsDir)
  copyTreeIfPresent(paths.legacyAgentDir, paths.agentDir)
  verifyDatabase(paths.databasePath)
  writeMigrationMarker(paths, status)
  return { status }
}
