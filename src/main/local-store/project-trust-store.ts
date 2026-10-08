import type Database from 'better-sqlite3'
import { resolve } from 'node:path'

/** 信任键规范化：resolve 消除相对段与分隔符差异；Windows 再叠大小写折叠，匹配与本机路径语义一致。 */
export function normalizeTrustKey(projectPath: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = resolve(projectPath)
  return platform === 'win32' ? resolved.toLowerCase() : resolved
}

export interface ProjectTrustRecord {
  /** 存储用的规范化键（Windows 已折叠大小写） */
  trustKey: string
  trusted: boolean
  /** 展示用原始路径，保留用户输入的大小写 */
  displayPath: string
  updatedAt: string
}

/**
 * 项目级资源信任决策（Project Trust）。
 * 门控的是「项目目录里的指令文件（AGENTS.md/CLAUDE.md）是否注入系统提示」，
 * 不是执行沙箱：信任后 Shell/文件权限仍由权限引擎与沙箱独立判定。
 */
export class ProjectTrustStore {
  constructor(private readonly db: Database.Database) {}

  get(namespace: string, projectPath: string): ProjectTrustRecord | null {
    const row = this.db.prepare(
      'SELECT trust_key, trusted, display_path, updated_at FROM project_trust WHERE namespace = ? AND trust_key = ?'
    ).get(namespace, normalizeTrustKey(projectPath)) as { trust_key: string; trusted: number; display_path: string; updated_at: string } | undefined
    if (!row) return null
    return { trustKey: row.trust_key, trusted: row.trusted === 1, displayPath: row.display_path, updatedAt: row.updated_at }
  }

  isTrusted(namespace: string, projectPath: string): boolean {
    return this.get(namespace, projectPath)?.trusted === true
  }

  set(namespace: string, projectPath: string, trusted: boolean, updatedAt = new Date().toISOString()): void {
    this.db.prepare(
      `INSERT INTO project_trust (namespace, trust_key, trusted, display_path, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(namespace, trust_key) DO UPDATE SET trusted = excluded.trusted, display_path = excluded.display_path, updated_at = excluded.updated_at`
    ).run(namespace, normalizeTrustKey(projectPath), trusted ? 1 : 0, resolve(projectPath), updatedAt)
  }

  /**
   * 存量项目一次性初始化为已信任：升级前用户已主动打开并使用这些项目，
   * 不做这步会让所有既有项目的指令文件静默失效。幂等（INSERT OR IGNORE），
   * 只补缺失行，不覆盖用户后来主动撤销的信任。
   */
  seedFromProjects(db: Database.Database, namespace: string): void {
    const rows = db.prepare('SELECT path FROM projects WHERE namespace = ?').all(namespace) as Array<{ path: string }>
    const insert = db.prepare(
      'INSERT OR IGNORE INTO project_trust (namespace, trust_key, trusted, display_path, updated_at) VALUES (?, ?, 1, ?, ?)'
    )
    const now = new Date().toISOString()
    for (const row of rows) insert.run(namespace, normalizeTrustKey(row.path), resolve(row.path), now)
  }

  list(namespace: string): ProjectTrustRecord[] {
    const rows = this.db.prepare(
      'SELECT trust_key, trusted, display_path, updated_at FROM project_trust WHERE namespace = ? ORDER BY updated_at DESC'
    ).all(namespace) as Array<{ trust_key: string; trusted: number; display_path: string; updated_at: string }>
    return rows.map((row) => ({ trustKey: row.trust_key, trusted: row.trusted === 1, displayPath: row.display_path, updatedAt: row.updated_at }))
  }
}
