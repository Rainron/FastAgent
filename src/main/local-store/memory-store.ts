import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { MemoryListQuery, MemoryRecord, MemoryScope, MemoryType, MemoryUpdateInput, PageResult, TurnContextSource } from '../../shared/types'
import { normalizePageSize, pageOffset, resolvePage } from '../../shared/pagination'
import { mapMemory, type MemoryRow } from './row-mappers'

/** 长期记忆、召回台账与回合级上下文来源。 */
export class MemoryStore {
  constructor(private readonly db: Database.Database) {}

  /**
   * 管理界面的记忆列表。默认只列 active：superseded 是被替代的历史版本，deleted 是用户软删，
   * 两者留在库里供追溯，但不该出现在默认视图里。
   */
  listMemories(namespace: string, query: MemoryListQuery = {}): PageResult<MemoryRecord> {
    const conditions = ['namespace = ?']
    const params: unknown[] = [namespace]
    conditions.push('status = ?')
    params.push(query.status ?? 'active')
    if (query.status === 'all') { conditions.pop(); params.pop() }
    if (query.scope) {
      conditions.push('scope = ?')
      params.push(query.scope)
    }
    if (query.scopeId !== undefined) {
      if (query.scopeId === null) conditions.push('scope_id IS NULL')
      else {
        conditions.push('scope_id = ?')
        params.push(query.scopeId)
      }
    }
    if (query.type) {
      conditions.push('type = ?')
      params.push(query.type)
    }
    if (query.sourceTurnId) {
      conditions.push('source_turn_id = ?')
      params.push(query.sourceTurnId)
    }
    const keyword = (query.keyword ?? '').trim()
    if (keyword) {
      conditions.push('content LIKE ?')
      params.push(`%${keyword}%`)
    }
    const where = conditions.join(' AND ')
    const pageSize = normalizePageSize(query.pageSize)
    const { count } = this.db.prepare(`SELECT COUNT(*) AS count FROM memories WHERE ${where}`).get(...params) as { count: number }
    const page = resolvePage(query.page, count, pageSize)
    const rows = this.db.prepare(`
      SELECT memory_id, scope, scope_id, type, content, importance, confidence, source_conversation_id,
             source_turn_id, source_run_id, status, superseded_by, created_at, updated_at, last_accessed_at, expires_at
      FROM memories WHERE ${where}
      ORDER BY updated_at DESC, memory_id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, pageOffset(page, pageSize)) as MemoryRow[]
    return { items: rows.map(mapMemory), total: count, page, pageSize }
  }

  /** 逐轮召回命中落库；同回合重复写幂等（主键冲突忽略）。 */
  recordMemoryRecalls(namespace: string, conversationId: string, turnId: string, memoryIds: string[], now = Date.now()): void {
    if (!memoryIds.length) return
    const insert = this.db.prepare(`INSERT OR IGNORE INTO memory_recall_log
      (namespace, conversation_id, turn_id, memory_id, recalled_at) VALUES (?, ?, ?, ?, ?)`)
    const write = this.db.transaction(() => {
      for (const memoryId of memoryIds) insert.run(namespace, conversationId, turnId, memoryId, now)
    })
    write()
  }

  /** 回合的召回命中，联表取记忆当前内容与状态；记忆被物理清空后自动不出现在结果里。 */
  listMemoryRecallsForTurn(namespace: string, turnId: string): Array<MemoryRecord & { recalledAt: number }> {
    const rows = this.db.prepare(`
      SELECT m.memory_id, m.scope, m.scope_id, m.type, m.content, m.importance, m.confidence,
             m.source_conversation_id, m.source_turn_id, m.source_run_id, m.status, m.superseded_by,
             m.created_at, m.updated_at, m.last_accessed_at, m.expires_at, r.recalled_at
      FROM memory_recall_log r JOIN memories m
        ON m.namespace = r.namespace AND m.memory_id = r.memory_id
      WHERE r.namespace = ? AND r.turn_id = ?
      ORDER BY r.recalled_at DESC, m.importance DESC
    `).all(namespace, turnId) as Array<MemoryRow & { recalled_at: number }>
    return rows.map((row) => ({ ...mapMemory(row), recalledAt: row.recalled_at }))
  }

  /** 本轮上下文来源落库；同回合重复写幂等（主键冲突覆盖标题与说明，来源本身不变）。 */
  recordTurnContextSources(namespace: string, conversationId: string, turnId: string, sources: readonly Omit<TurnContextSource, 'recordedAt'>[], now = Date.now()): void {
    if (!sources.length) return
    const insert = this.db.prepare(`INSERT INTO turn_context_sources
      (namespace, conversation_id, turn_id, kind, ref_id, title, locator, detail, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, turn_id, kind, ref_id) DO UPDATE SET title = excluded.title, locator = excluded.locator, detail = excluded.detail`)
    const write = this.db.transaction(() => {
      for (const source of sources) insert.run(namespace, conversationId, turnId, source.kind, source.refId, source.title, source.locator, source.detail, now)
    })
    write()
  }

  listTurnContextSources(namespace: string, turnId: string): TurnContextSource[] {
    const rows = this.db.prepare(`
      SELECT kind, ref_id, title, locator, detail, recorded_at
      FROM turn_context_sources WHERE namespace = ? AND turn_id = ?
      ORDER BY kind ASC, title ASC
    `).all(namespace, turnId) as Array<{ kind: TurnContextSource['kind']; ref_id: string; title: string; locator: string | null; detail: string | null; recorded_at: number }>
    return rows.map((row) => ({ kind: row.kind, refId: row.ref_id, title: row.title, locator: row.locator, detail: row.detail, recordedAt: row.recorded_at }))
  }

  /** 哪些回合有上下文来源记录；会话加载时一次拉全，避免逐轮探测。 */
  listContextSourceTurnIds(namespace: string, conversationId: string): string[] {
    const rows = this.db.prepare('SELECT DISTINCT turn_id FROM turn_context_sources WHERE namespace = ? AND conversation_id = ?').all(namespace, conversationId) as Array<{ turn_id: string }>
    return rows.map((row) => row.turn_id)
  }

  /** 会话内闭环的入口信号：这个会话里哪些回合有召回命中或提取产出。 */
  listMemoryActivityTurnIds(namespace: string, conversationId: string): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT turn_id FROM (
        SELECT turn_id FROM memory_recall_log WHERE namespace = ? AND conversation_id = ?
        UNION
        SELECT source_turn_id FROM memories WHERE namespace = ? AND source_conversation_id = ? AND source_turn_id IS NOT NULL
      )
    `).all(namespace, conversationId, namespace, conversationId) as Array<{ turn_id: string }>
    return rows.map((row) => row.turn_id)
  }

  countMemories(namespace: string, scope?: MemoryScope, scopeId?: string | null): number {
    if (!scope) {
      const { count } = this.db.prepare("SELECT COUNT(*) AS count FROM memories WHERE namespace = ? AND status = 'active'").get(namespace) as { count: number }
      return count
    }
    const { count } = this.db.prepare(`
      SELECT COUNT(*) AS count FROM memories
      WHERE namespace = ? AND status = 'active' AND scope = ? AND scope_id IS ?
    `).get(namespace, scope, scopeId ?? null) as { count: number }
    return count
  }

  /** 召回与抽取共用的作用域条件：当前项目 + 全局 +（可选）指定 Sub-agent。 */
  private scopeClause(workspaceId: string | null, agentId: string | null | undefined, params: unknown[]): string {
    const branches = ["scope = 'global'"]
    if (workspaceId) {
      branches.push("(scope = 'workspace' AND scope_id = ?)")
      params.push(workspaceId)
    }
    if (agentId) {
      branches.push("(scope = 'agent' AND scope_id = ?)")
      params.push(agentId)
    }
    return `(${branches.join(' OR ')})`
  }

  /**
   * FTS 检索，返回按相关度排序的记忆。
   * 短词（uv、go）在 trigram 索引里没有对应 token，只能走 LIKE 兜底，拼在 FTS 结果之后。
   */
  searchMemories(namespace: string, input: {
    match: string | null
    likeTerms?: readonly string[]
    workspaceId: string | null
    agentId?: string | null
    limit?: number
    now?: number
  }): MemoryRecord[] {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)
    const now = input.now ?? Date.now()
    const columns = `memories.memory_id, memories.scope, memories.scope_id, memories.type, memories.content,
      memories.importance, memories.confidence, memories.source_conversation_id, memories.source_turn_id,
      memories.source_run_id, memories.status, memories.superseded_by, memories.created_at, memories.updated_at,
      memories.last_accessed_at, memories.expires_at`
    const results: MemoryRecord[] = []
    const seen = new Set<string>()
    if (input.match) {
      const params: unknown[] = [input.match, namespace, now]
      const scope = this.scopeClause(input.workspaceId, input.agentId, params)
      const rows = this.db.prepare(`
        SELECT ${columns}
        FROM memories_fts JOIN memories ON memories.rowid = memories_fts.rowid
        WHERE memories_fts MATCH ?
          AND memories.namespace = ? AND memories.status = 'active'
          AND (memories.expires_at IS NULL OR memories.expires_at > ?)
          AND ${scope}
        ORDER BY bm25(memories_fts) ASC, memories.updated_at DESC
        LIMIT ?
      `).all(...params, limit) as MemoryRow[]
      for (const row of rows) {
        if (seen.has(row.memory_id)) continue
        seen.add(row.memory_id)
        results.push(mapMemory(row))
      }
    }
    const likeTerms = (input.likeTerms ?? []).filter((term) => term.trim().length > 0)
    if (likeTerms.length && results.length < limit) {
      const params: unknown[] = [namespace, now]
      const scope = this.scopeClause(input.workspaceId, input.agentId, params)
      const likeClause = likeTerms.map(() => 'content LIKE ?').join(' OR ')
      for (const term of likeTerms) params.push(`%${term}%`)
      const rows = this.db.prepare(`
        SELECT ${columns} FROM memories
        WHERE namespace = ? AND status = 'active'
          AND (expires_at IS NULL OR expires_at > ?)
          AND ${scope} AND (${likeClause})
        ORDER BY importance DESC, updated_at DESC
        LIMIT ?
      `).all(...params, limit - results.length) as MemoryRow[]
      for (const row of rows) {
        if (seen.has(row.memory_id)) continue
        seen.add(row.memory_id)
        results.push(mapMemory(row))
      }
    }
    return results
  }

  /** 抽取时给模型看的既有记忆：按重要性取头部即可，不需要全量。 */
  listActiveMemoriesForScopes(namespace: string, input: { workspaceId: string | null; agentId?: string | null; limit?: number }): MemoryRecord[] {
    const params: unknown[] = [namespace]
    const scope = this.scopeClause(input.workspaceId, input.agentId, params)
    const rows = this.db.prepare(`
      SELECT memory_id, scope, scope_id, type, content, importance, confidence, source_conversation_id,
             source_turn_id, source_run_id, status, superseded_by, created_at, updated_at, last_accessed_at, expires_at
      FROM memories
      WHERE namespace = ? AND status = 'active' AND ${scope}
      ORDER BY importance DESC, updated_at DESC
      LIMIT ?
    `).all(...params, Math.min(Math.max(input.limit ?? 20, 1), 100)) as MemoryRow[]
    return rows.map(mapMemory)
  }

  getMemory(namespace: string, id: string): MemoryRecord | null {
    const row = this.db.prepare(`
      SELECT memory_id, scope, scope_id, type, content, importance, confidence, source_conversation_id,
             source_turn_id, source_run_id, status, superseded_by, created_at, updated_at, last_accessed_at, expires_at
      FROM memories WHERE namespace = ? AND memory_id = ?
    `).get(namespace, id) as MemoryRow | undefined
    return row ? mapMemory(row) : null
  }

  /** 新建记忆。memories 与 memories_fts 必须在同一事务里写，否则检索会漏条或命中已删记录。 */
  createMemory(namespace: string, input: {
    id?: string
    scope: MemoryScope
    scopeId: string | null
    type: MemoryType
    content: string
    importance?: number
    confidence?: number
    sourceConversationId?: string | null
    sourceTurnId?: string | null
    sourceRunId?: string | null
    createdAt?: number
  }): MemoryRecord {
    const now = Date.now()
    const id = input.id ?? randomUUID()
    const write = this.db.transaction(() => {
      const info = this.db.prepare(`
        INSERT INTO memories(namespace, memory_id, scope, scope_id, type, content, importance, confidence,
          source_conversation_id, source_turn_id, source_run_id, status, superseded_by, created_at, updated_at, last_accessed_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, NULL, NULL)
      `).run(
        namespace, id, input.scope, input.scopeId, input.type, input.content,
        Math.min(5, Math.max(1, Math.round(input.importance ?? 3))),
        Math.min(1, Math.max(0, input.confidence ?? 0.8)),
        input.sourceConversationId ?? null, input.sourceTurnId ?? null, input.sourceRunId ?? null,
        input.createdAt ?? now, input.createdAt ?? now
      )
      this.db.prepare('INSERT INTO memories_fts(rowid, content) VALUES (?, ?)').run(info.lastInsertRowid, input.content)
    })
    write()
    return this.getMemory(namespace, id) as MemoryRecord
  }

  updateMemory(namespace: string, id: string, patch: MemoryUpdateInput): MemoryRecord | null {
    const row = this.db.prepare('SELECT rowid FROM memories WHERE namespace = ? AND memory_id = ?').get(namespace, id) as { rowid: number } | undefined
    if (!row) return null
    const write = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE memories SET
          content = COALESCE(?, content),
          type = COALESCE(?, type),
          importance = COALESCE(?, importance),
          status = COALESCE(?, status),
          updated_at = ?
        WHERE namespace = ? AND memory_id = ?
      `).run(
        patch.content ?? null,
        patch.type ?? null,
        patch.importance === undefined ? null : Math.min(5, Math.max(1, Math.round(patch.importance))),
        patch.status ?? null,
        Date.now(), namespace, id
      )
      if (patch.content !== undefined) {
        this.db.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(row.rowid)
        this.db.prepare('INSERT INTO memories_fts(rowid, content) VALUES (?, ?)').run(row.rowid, patch.content)
      }
    })
    write()
    return this.getMemory(namespace, id)
  }

  /** 旧记忆被新记忆推翻：置 superseded 并记下替代者，保留原文供用户追溯。 */
  supersedeMemory(namespace: string, oldId: string, newId: string) {
    this.db.prepare(`
      UPDATE memories SET status = 'superseded', superseded_by = ?, updated_at = ?
      WHERE namespace = ? AND memory_id = ? AND status = 'active'
    `).run(newId, Date.now(), namespace, oldId)
  }

  /** 重复抽取到同一条记忆时只刷新，不新增行。 */
  refreshMemory(namespace: string, id: string, importance: number) {
    this.db.prepare(`
      UPDATE memories SET importance = MAX(importance, ?), updated_at = ? WHERE namespace = ? AND memory_id = ?
    `).run(Math.min(5, Math.max(1, Math.round(importance))), Date.now(), namespace, id)
  }

  /** 召回后批量记一次访问时间；逐条 UPDATE 会把同步 SQLite 写放大到 TopK 次。 */
  touchMemories(namespace: string, ids: readonly string[]) {
    if (!ids.length) return
    const placeholders = ids.map(() => '?').join(', ')
    this.db.prepare(`UPDATE memories SET last_accessed_at = ? WHERE namespace = ? AND memory_id IN (${placeholders})`)
      .run(Date.now(), namespace, ...ids)
  }

  /** 用户删除单条：软删，FTS 行同步移除，避免检索命中已删内容。 */
  removeMemory(namespace: string, id: string) {
    const row = this.db.prepare('SELECT rowid FROM memories WHERE namespace = ? AND memory_id = ?').get(namespace, id) as { rowid: number } | undefined
    if (!row) return
    const write = this.db.transaction(() => {
      this.db.prepare("UPDATE memories SET status = 'deleted', updated_at = ? WHERE namespace = ? AND memory_id = ?").run(Date.now(), namespace, id)
      this.db.prepare('DELETE FROM memories_fts WHERE rowid = ?').run(row.rowid)
    })
    write()
  }

  /** 清空某个作用域：这一步是物理删除，用户在界面上已经确认过。 */
  clearMemories(namespace: string, scope?: MemoryScope, scopeId?: string | null): number {
    const conditions = ['namespace = ?']
    const params: unknown[] = [namespace]
    if (scope) {
      conditions.push('scope = ?')
      params.push(scope)
      conditions.push('scope_id IS ?')
      params.push(scopeId ?? null)
    }
    const where = conditions.join(' AND ')
    const rows = this.db.prepare(`SELECT rowid FROM memories WHERE ${where}`).all(...params) as Array<{ rowid: number }>
    if (!rows.length) return 0
    const write = this.db.transaction(() => {
      const removeFts = this.db.prepare('DELETE FROM memories_fts WHERE rowid = ?')
      for (const row of rows) removeFts.run(row.rowid)
      this.db.prepare(`DELETE FROM memories WHERE ${where}`).run(...params)
      this.db.prepare(`DELETE FROM memory_recall_log WHERE namespace = ? AND memory_id NOT IN (SELECT memory_id FROM memories WHERE memories.namespace = memory_recall_log.namespace)`).run(namespace)
    })
    write()
    return rows.length
  }
}
