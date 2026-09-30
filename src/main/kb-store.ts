import type Database from 'better-sqlite3'
import type { KbEntry, KbSource, KbSourceKind, KbSourceStatus } from '../shared/types'

/**
 * 项目知识库：用户手工沉淀到项目上的长文档/约定，与自动抽取的记忆分开存放。
 * 记忆是短事实、带重要性与生命周期；知识条目是人工策展的长文本，只做检索注入，不参与冲突合并。
 *
 * 条目有两种来源：手工录入（source_id 为 NULL）与文件/目录导入。导入的条目按文件切块，
 * 每块带原文定位（行区间或页码），检索结果因此能落回具体位置。
 */
export const KB_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS kb_entries (
    namespace TEXT NOT NULL,
    project_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    source_id TEXT,
    source_path TEXT,
    locator TEXT,
    PRIMARY KEY(namespace, project_id, entry_id)
  );
  /* kb_entries_source 索引不能写在这里：旧库的 kb_entries 建于来源字段之前，
     CREATE TABLE IF NOT EXISTS 不补列，建库阶段就会以 no such column 失败。
     它由 ensureKbEntrySourceColumns 在补完列之后创建。 */
  CREATE INDEX IF NOT EXISTS kb_entries_project ON kb_entries(namespace, project_id, updated_at DESC);
  CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(title, content, tokenize='trigram');
  /* 文件/目录来源。条目仍然存在 kb_entries 里，这张表只负责「从哪来、索引到第几版、状态如何」。 */
  CREATE TABLE IF NOT EXISTS kb_sources (
    namespace TEXT NOT NULL,
    source_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    file_count INTEGER NOT NULL DEFAULT 0,
    excludes TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(namespace, source_id)
  );
  CREATE INDEX IF NOT EXISTS kb_sources_project ON kb_sources(namespace, project_id, updated_at DESC);
  /* 逐文件内容哈希：增量更新靠它判断「这个文件这次要不要重切」。 */
  CREATE TABLE IF NOT EXISTS kb_source_files (
    namespace TEXT NOT NULL,
    source_id TEXT NOT NULL,
    path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    entry_count INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    PRIMARY KEY(namespace, source_id, path)
  );
`

/** 旧库的 kb_entries 建于来源字段之前，CREATE TABLE IF NOT EXISTS 不会补列。 */
export function ensureKbEntrySourceColumns(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(kb_entries)').all() as Array<{ name: string }>
  const names = new Set(columns.map((column) => column.name))
  if (!names.has('source_id')) db.exec('ALTER TABLE kb_entries ADD COLUMN source_id TEXT')
  if (!names.has('source_path')) db.exec('ALTER TABLE kb_entries ADD COLUMN source_path TEXT')
  if (!names.has('locator')) db.exec('ALTER TABLE kb_entries ADD COLUMN locator TEXT')
  // 列补齐之后才能建索引：写在建库 SQL 里的话，旧库会在建索引这一步直接失败。
  db.exec('CREATE INDEX IF NOT EXISTS kb_entries_source ON kb_entries(namespace, source_id)')
}

// KbEntry 类型定义在 shared/types/kb.ts，这里只负责存取。
interface KbRow {
  entry_id: string
  project_id: string
  title: string
  content: string
  created_at: number
  updated_at: number
  source_id: string | null
  source_path: string | null
  locator: string | null
}

interface KbSourceRow {
  source_id: string
  project_id: string
  kind: KbSourceKind
  path: string
  title: string
  status: KbSourceStatus
  error: string | null
  file_count: number
  excludes: string
  version: number
  created_at: number
  updated_at: number
}

const ENTRY_COLUMNS = 'entry_id, project_id, title, content, created_at, updated_at, source_id, source_path, locator'

function mapRow(row: KbRow): KbEntry {
  return {
    id: row.entry_id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceId: row.source_id,
    sourcePath: row.source_path,
    locator: row.locator
  }
}

function mapSource(row: KbSourceRow): KbSource {
  let excludes: string[] = []
  try { excludes = JSON.parse(row.excludes) as string[] } catch { excludes = [] }
  return {
    id: row.source_id,
    projectId: row.project_id,
    kind: row.kind,
    path: row.path,
    title: row.title,
    status: row.status,
    error: row.error,
    fileCount: row.file_count,
    entryCount: 0,
    excludes,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export interface KbChunkInput {
  title: string
  content: string
  locator: string | null
}

export class KbStore {
  constructor(private readonly db: Database.Database) {}

  /** 标题与正文都进索引；写入侧同一事务同步两张表，与 memories_fts 同一套约定。 */
  save(namespace: string, projectId: string, input: { id?: string; title: string; content: string }): KbEntry {
    const now = Date.now()
    if (input.id) {
      const existing = this.db.prepare('SELECT rowid FROM kb_entries WHERE namespace = ? AND project_id = ? AND entry_id = ?').get(namespace, projectId, input.id) as { rowid: number } | undefined
      if (!existing) throw new Error('知识条目不存在')
      const write = this.db.transaction(() => {
        this.db.prepare('UPDATE kb_entries SET title = ?, content = ?, updated_at = ? WHERE namespace = ? AND project_id = ? AND entry_id = ?').run(input.title, input.content, now, namespace, projectId, input.id)
        this.db.prepare('DELETE FROM kb_fts WHERE rowid = ?').run(existing.rowid)
        this.db.prepare('INSERT INTO kb_fts(rowid, title, content) VALUES (?, ?, ?)').run(existing.rowid, input.title, input.content)
      })
      write()
      return { id: input.id, projectId, title: input.title, content: input.content, createdAt: 0, updatedAt: now, sourceId: null, sourcePath: null, locator: null }
    }
    const id = newId('kb')
    const write = this.db.transaction(() => {
      const result = this.db.prepare('INSERT INTO kb_entries(namespace, project_id, entry_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(namespace, projectId, id, input.title, input.content, now, now)
      this.db.prepare('INSERT INTO kb_fts(rowid, title, content) VALUES (?, ?, ?)').run(result.lastInsertRowid, input.title, input.content)
    })
    write()
    return { id, projectId, title: input.title, content: input.content, createdAt: now, updatedAt: now, sourceId: null, sourcePath: null, locator: null }
  }

  remove(namespace: string, projectId: string, id: string): void {
    const write = this.db.transaction(() => {
      const existing = this.db.prepare('SELECT rowid FROM kb_entries WHERE namespace = ? AND project_id = ? AND entry_id = ?').get(namespace, projectId, id) as { rowid: number } | undefined
      if (!existing) return
      this.db.prepare('DELETE FROM kb_entries WHERE namespace = ? AND project_id = ? AND entry_id = ?').run(namespace, projectId, id)
      this.db.prepare('DELETE FROM kb_fts WHERE rowid = ?').run(existing.rowid)
    })
    write()
  }

  /** 项目删除时同步清 FTS：孤儿 fts 行会让 rowid 复用撞唯一键。 */
  deleteProjectEntries(namespace: string, projectId: string): void {
    const write = this.db.transaction(() => {
      const rows = this.db.prepare('SELECT rowid FROM kb_entries WHERE namespace = ? AND project_id = ?').all(namespace, projectId) as Array<{ rowid: number }>
      const removeFts = this.db.prepare('DELETE FROM kb_fts WHERE rowid = ?')
      for (const row of rows) removeFts.run(row.rowid)
      this.db.prepare('DELETE FROM kb_entries WHERE namespace = ? AND project_id = ?').run(namespace, projectId)
      const sources = this.db.prepare('SELECT source_id FROM kb_sources WHERE namespace = ? AND project_id = ?').all(namespace, projectId) as Array<{ source_id: string }>
      const removeFiles = this.db.prepare('DELETE FROM kb_source_files WHERE namespace = ? AND source_id = ?')
      for (const source of sources) removeFiles.run(namespace, source.source_id)
      this.db.prepare('DELETE FROM kb_sources WHERE namespace = ? AND project_id = ?').run(namespace, projectId)
    })
    write()
  }

  list(namespace: string, projectId: string): KbEntry[] {
    const rows = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM kb_entries WHERE namespace = ? AND project_id = ? ORDER BY updated_at DESC`).all(namespace, projectId) as KbRow[]
    return rows.map(mapRow)
  }

  /**
   * 检索：bm25 相关度 + 更新时间兜底。查询计划复用 memory-query 的产出
   * （match 表达式 + LIKE 短词），这里只做执行与截断。
   *
   * 来源已失效（stale：磁盘上找不到了）的条目一律不返回：撤销访问后旧片段
   * 还能被引用，是需求明确要避免的情况。
   */
  search(namespace: string, projectId: string, plan: { match: string | null; likeTerms: readonly string[] }, limit: number): KbEntry[] {
    const capped = Math.min(Math.max(limit, 1), 10)
    const results: KbEntry[] = []
    const seen = new Set<string>()
    const liveSource = "(e.source_id IS NULL OR EXISTS (SELECT 1 FROM kb_sources s WHERE s.namespace = e.namespace AND s.source_id = e.source_id AND s.status != 'stale'))"
    if (plan.match) {
      const rows = this.db.prepare(`
        SELECT ${ENTRY_COLUMNS.split(', ').map((column) => `e.${column}`).join(', ')}
        FROM kb_fts JOIN kb_entries e ON e.rowid = kb_fts.rowid
        WHERE kb_fts MATCH ? AND e.namespace = ? AND e.project_id = ? AND ${liveSource}
        ORDER BY bm25(kb_fts) ASC, e.updated_at DESC
        LIMIT ?
      `).all(plan.match, namespace, projectId, capped) as KbRow[]
      for (const row of rows) {
        if (seen.has(row.entry_id)) continue
        seen.add(row.entry_id)
        results.push(mapRow(row))
      }
    }
    const likeTerms = plan.likeTerms.filter((term) => term.trim().length > 0)
    if (likeTerms.length && results.length < capped) {
      const likeClause = likeTerms.map(() => '(e.title LIKE ? OR e.content LIKE ?)').join(' OR ')
      const params: unknown[] = [namespace, projectId]
      for (const term of likeTerms) params.push(`%${term}%`, `%${term}%`)
      const rows = this.db.prepare(`
        SELECT ${ENTRY_COLUMNS.split(', ').map((column) => `e.${column}`).join(', ')}
        FROM kb_entries e
        WHERE e.namespace = ? AND e.project_id = ? AND (${likeClause}) AND ${liveSource}
        ORDER BY e.updated_at DESC LIMIT ?
      `).all(...params, capped) as KbRow[]
      for (const row of rows) {
        if (seen.has(row.entry_id)) continue
        seen.add(row.entry_id)
        results.push(mapRow(row))
      }
    }
    return results.slice(0, capped)
  }

  /**
   * 统一搜索用的按关键词检索。与 search() 分开：那条路服务于自动注入，
   * 走的是记忆那套查询计划；这条是用户手输的原词，直接 LIKE 更可预期。
   */
  searchByKeyword(namespace: string, projectId: string | null, keyword: string, limit: number): KbEntry[] {
    const pattern = `%${keyword}%`
    const rows = this.db.prepare(`
      SELECT ${ENTRY_COLUMNS} FROM kb_entries
      WHERE namespace = ? AND (? IS NULL OR project_id = ?) AND (title LIKE ? OR content LIKE ?)
      ORDER BY updated_at DESC LIMIT ?
    `).all(namespace, projectId, projectId, pattern, pattern, limit) as KbRow[]
    return rows.map(mapRow)
  }

  // ---- 来源 ----

  createSource(namespace: string, input: { projectId: string; kind: KbSourceKind; path: string; title: string; excludes: readonly string[] }, now = Date.now()): KbSource {
    const existing = this.db.prepare('SELECT source_id FROM kb_sources WHERE namespace = ? AND project_id = ? AND path = ?').get(namespace, input.projectId, input.path) as { source_id: string } | undefined
    if (existing) throw new Error('该路径已经绑定到本项目的知识库')
    const id = newId('kbs')
    this.db.prepare(`INSERT INTO kb_sources(namespace, source_id, project_id, kind, path, title, status, error, file_count, excludes, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'indexing', NULL, 0, ?, 0, ?, ?)`)
      .run(namespace, id, input.projectId, input.kind, input.path, input.title, JSON.stringify([...input.excludes]), now, now)
    return this.requireSource(namespace, id)
  }

  getSource(namespace: string, sourceId: string): KbSource | null {
    const row = this.db.prepare('SELECT * FROM kb_sources WHERE namespace = ? AND source_id = ?').get(namespace, sourceId) as KbSourceRow | undefined
    if (!row) return null
    const source = mapSource(row)
    source.entryCount = this.countSourceEntries(namespace, sourceId)
    return source
  }

  requireSource(namespace: string, sourceId: string): KbSource {
    const source = this.getSource(namespace, sourceId)
    if (!source) throw new Error('知识来源不存在')
    return source
  }

  listSources(namespace: string, projectId: string): KbSource[] {
    const rows = this.db.prepare('SELECT * FROM kb_sources WHERE namespace = ? AND project_id = ? ORDER BY updated_at DESC').all(namespace, projectId) as KbSourceRow[]
    return rows.map((row) => {
      const source = mapSource(row)
      source.entryCount = this.countSourceEntries(namespace, row.source_id)
      return source
    })
  }

  /** 条目数只在这里算：listXxx().length 会把整段正文读出来只为求个长度。 */
  countSourceEntries(namespace: string, sourceId: string): number {
    const { count } = this.db.prepare('SELECT COUNT(*) AS count FROM kb_entries WHERE namespace = ? AND source_id = ?').get(namespace, sourceId) as { count: number }
    return count
  }

  updateSourceStatus(namespace: string, sourceId: string, patch: { status: KbSourceStatus; error?: string | null; fileCount?: number; bumpVersion?: boolean }, now = Date.now()): KbSource {
    this.db.prepare(`UPDATE kb_sources SET status = ?, error = ?, file_count = COALESCE(?, file_count),
      version = version + ?, updated_at = ? WHERE namespace = ? AND source_id = ?`)
      .run(patch.status, patch.error ?? null, patch.fileCount ?? null, patch.bumpVersion ? 1 : 0, now, namespace, sourceId)
    return this.requireSource(namespace, sourceId)
  }

  removeSource(namespace: string, sourceId: string): void {
    const write = this.db.transaction(() => {
      const rows = this.db.prepare('SELECT rowid FROM kb_entries WHERE namespace = ? AND source_id = ?').all(namespace, sourceId) as Array<{ rowid: number }>
      const removeFts = this.db.prepare('DELETE FROM kb_fts WHERE rowid = ?')
      for (const row of rows) removeFts.run(row.rowid)
      this.db.prepare('DELETE FROM kb_entries WHERE namespace = ? AND source_id = ?').run(namespace, sourceId)
      this.db.prepare('DELETE FROM kb_source_files WHERE namespace = ? AND source_id = ?').run(namespace, sourceId)
      this.db.prepare('DELETE FROM kb_sources WHERE namespace = ? AND source_id = ?').run(namespace, sourceId)
    })
    write()
  }

  /** 增量判断用的「上次索引到什么」：路径 → 内容哈希。 */
  listSourceFileHashes(namespace: string, sourceId: string): Map<string, string> {
    const rows = this.db.prepare('SELECT path, content_hash FROM kb_source_files WHERE namespace = ? AND source_id = ?').all(namespace, sourceId) as Array<{ path: string; content_hash: string }>
    return new Map(rows.map((row) => [row.path, row.content_hash]))
  }

  /** 整文件替换：先删这个文件的旧条目，再写新块。文件内容变了就整份重切，不做块级 diff。 */
  replaceFileEntries(namespace: string, input: { projectId: string; sourceId: string; path: string; contentHash: string; chunks: readonly KbChunkInput[] }, now = Date.now()): number {
    const write = this.db.transaction(() => {
      this.deleteFileEntriesInternal(namespace, input.sourceId, input.path)
      const insertEntry = this.db.prepare(`INSERT INTO kb_entries(namespace, project_id, entry_id, title, content, created_at, updated_at, source_id, source_path, locator)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      const insertFts = this.db.prepare('INSERT INTO kb_fts(rowid, title, content) VALUES (?, ?, ?)')
      for (const chunk of input.chunks) {
        const result = insertEntry.run(namespace, input.projectId, newId('kbc'), chunk.title, chunk.content, now, now, input.sourceId, input.path, chunk.locator)
        insertFts.run(result.lastInsertRowid, chunk.title, chunk.content)
      }
      this.db.prepare(`INSERT INTO kb_source_files(namespace, source_id, path, content_hash, entry_count, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(namespace, source_id, path) DO UPDATE SET content_hash = excluded.content_hash, entry_count = excluded.entry_count, indexed_at = excluded.indexed_at`)
        .run(namespace, input.sourceId, input.path, input.contentHash, input.chunks.length, now)
      return input.chunks.length
    })
    return write()
  }

  /** 文件在来源里消失（删除 / 改名 / 被排除）时清掉它的条目，避免旧片段继续被检索到。 */
  removeFileEntries(namespace: string, sourceId: string, path: string): void {
    const write = this.db.transaction(() => {
      this.deleteFileEntriesInternal(namespace, sourceId, path)
      this.db.prepare('DELETE FROM kb_source_files WHERE namespace = ? AND source_id = ? AND path = ?').run(namespace, sourceId, path)
    })
    write()
  }

  private deleteFileEntriesInternal(namespace: string, sourceId: string, path: string): void {
    const rows = this.db.prepare('SELECT rowid FROM kb_entries WHERE namespace = ? AND source_id = ? AND source_path = ?').all(namespace, sourceId, path) as Array<{ rowid: number }>
    const removeFts = this.db.prepare('DELETE FROM kb_fts WHERE rowid = ?')
    for (const row of rows) removeFts.run(row.rowid)
    this.db.prepare('DELETE FROM kb_entries WHERE namespace = ? AND source_id = ? AND source_path = ?').run(namespace, sourceId, path)
  }
}
