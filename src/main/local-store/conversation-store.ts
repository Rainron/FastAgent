import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Attachment, Citation, ArtifactReference, ConversationPageQuery, ConversationRunState, ConversationTurn, ConversationTurnPatch, PageQuery, PageResult, ProjectRecord, TodoItem, ToolCallRecord, TurnActivity, TurnRuntimeConfig, TurnSessionAnchor, TurnStatus } from '../../shared/types'
import { normalizePageSize, pageOffset, resolvePage } from '../../shared/pagination'
import { conversationFilter } from './conversation-filter'
import { defaultRuntimeConfig, mapConversation, normalizeRuntimeConfig, normalizeTurnActivity, parseJson, type ConversationRecord, type ConversationRow, type TurnRow } from './row-mappers'

export interface ConversationMessage {
  role: 'user' | 'assistant'
  text: string
  createdAt: string
}

type TurnPatch = ConversationTurnPatch

export interface ConversationStoreDeps {
  /** 清空会话时一并删掉模型用量，归属 model-usage-store。 */
  deleteModelUsage: (namespace: string, conversationId: string) => void
  /** 删项目前先清知识库（含 FTS），归属 kb-store。 */
  deleteProjectKbEntries: (namespace: string, projectId: string) => void
}

/** 会话、回合、项目、运行状态、工具调用与待办。 */
export class ConversationStore {
  constructor(private readonly db: Database.Database, private readonly deps: ConversationStoreDeps) {}

  createConversation(namespace: string, input: { id: string; title: string; createdAt?: string; projectId?: string | null }): ConversationRecord {
    const createdAt = input.createdAt ?? new Date().toISOString()
    this.db.prepare(`
      INSERT INTO conversations(namespace, conversation_id, title, created_at, updated_at, archived, project_id)
      VALUES (?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(namespace, conversation_id) DO UPDATE SET title = excluded.title, archived = 0, project_id = excluded.project_id
    `).run(namespace, input.id, input.title, createdAt, createdAt, input.projectId ?? null)
    return this.getConversation(namespace, input.id) as ConversationRecord
  }

  getConversation(namespace: string, id: string): ConversationRecord | null {
    const row = this.db.prepare(`
      SELECT conversation_id, title, created_at, updated_at, archived, project_id, model_id
      FROM conversations WHERE namespace = ? AND conversation_id = ?
    `).get(namespace, id) as ConversationRow | undefined
    return row ? mapConversation(row) : null
  }

  /** 会话归属项目的目录；未归属返回 null。运行时 cwd 只认这个，避免用进程级「当前工作区」串到别的会话。 */
  getConversationRoot(namespace: string, conversationId: string): string | null {
    const row = this.db.prepare(`
      SELECT projects.path AS path
      FROM conversations JOIN projects
        ON projects.namespace = conversations.namespace AND projects.project_id = conversations.project_id
      WHERE conversations.namespace = ? AND conversations.conversation_id = ?
    `).get(namespace, conversationId) as { path: string } | undefined
    return row?.path ?? null
  }

  listConversationsPage(namespace: string, query: ConversationPageQuery = {}, archived = false): PageResult<ConversationRecord> {
    const pageSize = normalizePageSize(query.pageSize)
    const { where, params } = conversationFilter(namespace, query, archived)
    const { count } = this.db.prepare(`SELECT COUNT(*) AS count FROM conversations WHERE ${where}`).get(...params) as { count: number }
    const page = resolvePage(query.page, count, pageSize)
    const rows = this.db.prepare(`
      SELECT conversation_id, title, created_at, updated_at, archived, project_id, model_id
      FROM conversations WHERE ${where}
      ORDER BY updated_at DESC, conversation_id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, pageOffset(page, pageSize)) as ConversationRow[]
    return { items: rows.map(mapConversation), total: count, page, pageSize }
  }

  /** 统一搜索用：按标题匹配。会话正文不参与——逐轮反序列化整段历史会把主进程顶死。 */
  searchConversationsByTitle(namespace: string, keyword: string, projectId: string | null, limit: number): ConversationRecord[] {
    const rows = this.db.prepare(`
      SELECT conversation_id, title, created_at, updated_at, archived, project_id, model_id
      FROM conversations
      WHERE namespace = ? AND archived = 0 AND title LIKE ? AND (? IS NULL OR project_id = ?)
      ORDER BY updated_at DESC LIMIT ?
    `).all(namespace, `%${keyword}%`, projectId, projectId, limit) as Array<{
      conversation_id: string; title: string; created_at: string; updated_at: string
      archived: number; project_id: string | null; model_id: number | null
    }>
    return rows.map((row) => ({
      id: row.conversation_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archived: Boolean(row.archived),
      projectId: row.project_id,
      modelId: row.model_id
    }))
  }

  listConversations(namespace: string, archived = false): ConversationRecord[] {
    const rows = this.db.prepare(`
      SELECT conversation_id, title, created_at, updated_at, archived, project_id, model_id
      FROM conversations WHERE namespace = ? AND archived = ?
      ORDER BY updated_at DESC, conversation_id DESC
    `).all(namespace, archived ? 1 : 0) as ConversationRow[]
    return rows.map(mapConversation)
  }

  listRunStates(namespace: string): ConversationRunState[] {
    const rows = this.db.prepare('SELECT conversation_id, project_id, status, unread, updated_at FROM conversation_run_states WHERE namespace = ?').all(namespace) as Array<{ conversation_id: string; project_id: string | null; status: ConversationRunState['status']; unread: number; updated_at: number }>
    return rows.map((row) => ({ conversationId: row.conversation_id, projectId: row.project_id, status: row.status, hasUnreadResult: Boolean(row.unread), updatedAt: row.updated_at }))
  }

  saveRunState(namespace: string, state: ConversationRunState) {
    this.db.prepare(`INSERT INTO conversation_run_states(namespace, conversation_id, project_id, status, unread, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(namespace, conversation_id) DO UPDATE SET project_id=excluded.project_id, status=excluded.status, unread=excluded.unread, updated_at=excluded.updated_at`).run(namespace, state.conversationId, state.projectId, state.status, state.hasUnreadResult ? 1 : 0, state.updatedAt)
  }

  markRunRead(namespace: string, conversationId: string) {
    this.db.prepare('UPDATE conversation_run_states SET unread = 0, updated_at = ? WHERE namespace = ? AND conversation_id = ?').run(Date.now(), namespace, conversationId)
  }

  appendMessage(namespace: string, conversationId: string, message: ConversationMessage, messageId = randomUUID()) {
    const updated = this.db.transaction(() => {
      const result = this.db.prepare(`
        INSERT INTO conversation_messages(namespace, conversation_id, message_id, role, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(namespace, conversationId, messageId, message.role, message.text, message.createdAt)
      if (result.changes !== 1) throw new Error('消息保存失败')
      this.db.prepare(`
        UPDATE conversations SET updated_at = ?, archived = 0
        WHERE namespace = ? AND conversation_id = ?
      `).run(message.createdAt, namespace, conversationId)
    })
    updated()
  }

  listMessages(namespace: string, conversationId: string): ConversationMessage[] {
    const rows = this.db.prepare(`
      SELECT role, text, created_at FROM conversation_messages
      WHERE namespace = ? AND conversation_id = ?
      ORDER BY created_at ASC, message_id ASC
    `).all(namespace, conversationId) as Array<{ role: 'user' | 'assistant'; text: string; created_at: string }>
    return rows.map((row) => ({ role: row.role, text: row.text, createdAt: row.created_at }))
  }

  createTurn(namespace: string, conversationId: string, input: {
    id?: string
    userMessage: { text: string; createdAt?: string }
    attachments?: Attachment[]
    activity?: TurnActivity | null
    assistantMessage?: { text: string; createdAt?: string } | null
    citations?: Citation[]
    artifacts?: ArtifactReference[]
    runtimeConfig?: Partial<TurnRuntimeConfig>
    status?: TurnStatus
    createdAt?: string
    updatedAt?: string
  }): ConversationTurn {
    const id = input.id ?? `turn-${randomUUID()}`
    const createdAt = input.createdAt ?? input.userMessage.createdAt ?? new Date().toISOString()
    const updatedAt = input.updatedAt ?? createdAt
    const userMessage = { text: input.userMessage.text, createdAt: input.userMessage.createdAt ?? createdAt }
    const assistantMessage = input.assistantMessage === undefined || input.assistantMessage === null
      ? null
      : { text: input.assistantMessage.text, createdAt: input.assistantMessage.createdAt ?? updatedAt }
    const runtimeConfig = { ...defaultRuntimeConfig(), ...(input.runtimeConfig ?? {}) }
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO conversation_turns(namespace, conversation_id, turn_id, user_message, attachments, activity, assistant_message, citations, artifacts, runtime_config, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(namespace, conversationId, id, JSON.stringify(userMessage), JSON.stringify(input.attachments ?? []), input.activity == null ? null : JSON.stringify(input.activity), assistantMessage == null ? null : JSON.stringify(assistantMessage), JSON.stringify(input.citations ?? []), JSON.stringify(input.artifacts ?? []), JSON.stringify(runtimeConfig), input.status ?? (assistantMessage ? 'completed' : 'working'), createdAt, updatedAt)
      this.db.prepare('UPDATE conversations SET updated_at = ?, archived = 0 WHERE namespace = ? AND conversation_id = ?').run(updatedAt, namespace, conversationId)
    })()
    return this.getTurn(namespace, id) as ConversationTurn
  }

  getTurn(namespace: string, turnId: string): ConversationTurn | null {
    const row = this.db.prepare('SELECT * FROM conversation_turns WHERE namespace = ? AND turn_id = ?').get(namespace, turnId) as TurnRow | undefined
    return row ? this.mapTurn(row) : null
  }

  listTurns(namespace: string, conversationId: string): ConversationTurn[] {
    const rows = this.db.prepare('SELECT * FROM conversation_turns WHERE namespace = ? AND conversation_id = ? ORDER BY created_at ASC, turn_id ASC').all(namespace, conversationId) as TurnRow[]
    return rows.map((row) => this.mapTurn(row))
  }

  /**
   * 末轮的运行配置与状态。会话概览只需要这两项，走 listTurns 会把整段历史
   * 连同 activity/events 一起反序列化，列表页上是按会话数放大的浪费。
   * 排序与 listTurns 保持一致（created_at, turn_id），取反向第一条。
   */
  latestTurnRuntime(namespace: string, conversationId: string): { runtimeConfig: TurnRuntimeConfig; status: TurnStatus } | null {
    const row = this.db.prepare('SELECT runtime_config, status FROM conversation_turns WHERE namespace = ? AND conversation_id = ? ORDER BY created_at DESC, turn_id DESC LIMIT 1').get(namespace, conversationId) as { runtime_config: string; status: TurnStatus } | undefined
    if (!row) return null
    return { runtimeConfig: { ...defaultRuntimeConfig(), ...normalizeRuntimeConfig(parseJson<Partial<TurnRuntimeConfig>>(row.runtime_config, {})) }, status: row.status }
  }

  /**
   * 高频路径：运行中每条事件都要写一次整轮 activity。调用方手上已经有这一轮时用 known 传进来，
   * 省掉一次整份反序列化；返回值直接由 next 归一化得出，再省一次读回。
   */
  updateTurn(namespace: string, turnId: string, patch: TurnPatch, known?: ConversationTurn | null): ConversationTurn | null {
    const existing = known && known.id === turnId ? known : this.getTurn(namespace, turnId)
    if (!existing) return null
    const next: ConversationTurn = {
      ...existing,
      ...patch,
      userMessage: patch.userMessage ?? existing.userMessage,
      attachments: patch.attachments ?? existing.attachments,
      activity: patch.activity === undefined ? existing.activity : patch.activity,
      assistantMessage: patch.assistantMessage === undefined ? existing.assistantMessage : patch.assistantMessage,
      citations: patch.citations ?? existing.citations,
      artifacts: patch.artifacts ?? existing.artifacts,
      runtimeConfig: patch.runtimeConfig ? { ...existing.runtimeConfig, ...patch.runtimeConfig } : existing.runtimeConfig,
      updatedAt: new Date().toISOString()
    }
    this.db.prepare(`
      UPDATE conversation_turns SET user_message = ?, attachments = ?, activity = ?, assistant_message = ?, citations = ?, artifacts = ?, runtime_config = ?, status = ?, updated_at = ?
      WHERE namespace = ? AND turn_id = ?
    `).run(JSON.stringify(next.userMessage), JSON.stringify(next.attachments), next.activity == null ? null : JSON.stringify(next.activity), next.assistantMessage == null ? null : JSON.stringify(next.assistantMessage), JSON.stringify(next.citations), JSON.stringify(next.artifacts), JSON.stringify(next.runtimeConfig), next.status, next.updatedAt, namespace, turnId)
    this.db.prepare('UPDATE conversations SET updated_at = ?, archived = 0 WHERE namespace = ? AND conversation_id = ?').run(next.updatedAt, namespace, existing.conversationId)
    // 与 mapTurn 读回的结果一致：写进去的就是 next，只差 activity 的状态归一化这一步。
    return { ...next, activity: normalizeTurnActivity(next.activity ?? null, next.status) }
  }

  deleteTurn(namespace: string, turnId: string): ConversationTurn | null {
    const turn = this.getTurn(namespace, turnId)
    if (!turn) return null
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM conversation_turns WHERE namespace = ? AND turn_id = ?').run(namespace, turnId)
      const latest = this.db.prepare('SELECT MAX(updated_at) AS updated_at FROM conversation_turns WHERE namespace = ? AND conversation_id = ?').get(namespace, turn.conversationId) as { updated_at: string | null }
      if (latest.updated_at) this.db.prepare('UPDATE conversations SET updated_at = ? WHERE namespace = ? AND conversation_id = ?').run(latest.updated_at, namespace, turn.conversationId)
    })()
    return turn
  }

  /**
   * 删除某一轮之后的全部回合（不含该轮），返回被删的 id。排序口径与 listTurns 一致。
   * 重跑/编辑重发第 N 轮时调用：后面的对话基于旧回答展开，留着只会和新回答对不上。
   */
  deleteTurnsAfter(namespace: string, conversationId: string, turnId: string): string[] {
    const anchor = this.db.prepare('SELECT created_at FROM conversation_turns WHERE namespace = ? AND conversation_id = ? AND turn_id = ?').get(namespace, conversationId, turnId) as { created_at: string } | undefined
    if (!anchor) return []
    const rows = this.db.prepare(`
      SELECT turn_id FROM conversation_turns
      WHERE namespace = ? AND conversation_id = ? AND (created_at > ? OR (created_at = ? AND turn_id > ?))
    `).all(namespace, conversationId, anchor.created_at, anchor.created_at, turnId) as Array<{ turn_id: string }>
    if (!rows.length) return []
    const remove = this.db.prepare('DELETE FROM conversation_turns WHERE namespace = ? AND turn_id = ?')
    this.db.transaction(() => { for (const row of rows) remove.run(namespace, row.turn_id) })()
    return rows.map((row) => row.turn_id)
  }

  getTurnSessionAnchor(namespace: string, turnId: string): TurnSessionAnchor | null {
    const row = this.db.prepare('SELECT session_anchor FROM conversation_turns WHERE namespace = ? AND turn_id = ?').get(namespace, turnId) as { session_anchor: string | null } | undefined
    const anchor = parseJson<TurnSessionAnchor | null>(row?.session_anchor ?? null, null)
    return anchor && typeof anchor.sessionFile === 'string' && anchor.sessionFile ? { sessionFile: anchor.sessionFile, leafId: typeof anchor.leafId === 'string' ? anchor.leafId : null } : null
  }

  setTurnSessionAnchor(namespace: string, turnId: string, anchor: TurnSessionAnchor | null) {
    this.db.prepare('UPDATE conversation_turns SET session_anchor = ? WHERE namespace = ? AND turn_id = ?').run(anchor ? JSON.stringify(anchor) : null, namespace, turnId)
  }

  restoreTurn(namespace: string, turn: ConversationTurn): ConversationTurn {
    return this.createTurn(namespace, turn.conversationId, turn)
  }

  private mapTurn(row: TurnRow): ConversationTurn {
    return {
      id: row.turn_id,
      conversationId: row.conversation_id,
      userMessage: parseJson(row.user_message, { text: '', createdAt: row.created_at }),
      attachments: parseJson<Attachment[]>(row.attachments, []),
      activity: normalizeTurnActivity(parseJson<TurnActivity | null>(row.activity, null), row.status),
      assistantMessage: parseJson<ConversationTurn['assistantMessage']>(row.assistant_message, null),
      citations: parseJson<Citation[]>(row.citations, []),
      artifacts: parseJson<ArtifactReference[]>(row.artifacts, []),
      runtimeConfig: { ...defaultRuntimeConfig(), ...normalizeRuntimeConfig(parseJson<Partial<TurnRuntimeConfig>>(row.runtime_config, {})) },
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /** 重命名只动标题，不碰 updated_at：改个名字不该把会话顶到列表最前。 */
  renameConversation(namespace: string, id: string, title: string): ConversationRecord | null {
    const trimmed = title.trim()
    if (!trimmed) throw new Error('会话标题不能为空')
    this.db.prepare('UPDATE conversations SET title = ? WHERE namespace = ? AND conversation_id = ?').run(trimmed, namespace, id)
    return this.getConversation(namespace, id)
  }

  archiveConversation(namespace: string, id: string) {
    this.db.prepare('UPDATE conversations SET archived = 1 WHERE namespace = ? AND conversation_id = ?').run(namespace, id)
  }

  removeConversation(namespace: string, id: string) {
    this.db.prepare('DELETE FROM conversations WHERE namespace = ? AND conversation_id = ?').run(namespace, id)
  }

  /** 清空会话的全部消息、运行时与上下文状态，保留会话条目本身并重置标题；返回被删除的轮次数。 */
  clearConversationTurns(namespace: string, conversationId: string): number {
    return this.db.transaction(() => {
      const { count } = this.db.prepare('SELECT COUNT(*) AS count FROM conversation_turns WHERE namespace = ? AND conversation_id = ?').get(namespace, conversationId) as { count: number }
      this.deps.deleteModelUsage(namespace, conversationId)
      this.db.prepare('DELETE FROM conversation_turns WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      // 这些表不随 turn 外键级联，且轮次清空后模型运行时、压缩记录等一并失效。
      this.db.prepare('DELETE FROM conversation_messages WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM tool_calls WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM session_todos WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM conversation_summaries WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM conversation_compactions WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM conversation_context_state WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM conversation_model_runtime WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('DELETE FROM turn_context_sources WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      // 未读结果与运行状态属于被清掉的那些轮次，留着会让侧栏顶着一个指向空会话的红点。
      this.db.prepare('DELETE FROM conversation_run_states WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      this.db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE namespace = ? AND conversation_id = ?').run('新对话', new Date().toISOString(), namespace, conversationId)
      return count
    })()
  }

  listProjectsPage(namespace: string, query: PageQuery = {}, archived = false): PageResult<ProjectRecord> {
    const pageSize = normalizePageSize(query.pageSize)
    const keyword = query.keyword?.trim() || null
    const { count } = this.db.prepare(`SELECT COUNT(*) AS count FROM projects WHERE namespace = ? AND archived = ? AND (? IS NULL OR name LIKE '%' || ? || '%' OR path LIKE '%' || ? || '%')`).get(namespace, archived ? 1 : 0, keyword, keyword, keyword) as { count: number }
    const page = resolvePage(query.page, count, pageSize)
    const rows = this.db.prepare(`SELECT project_id, name, path, color, archived, created_at, updated_at FROM projects WHERE namespace = ? AND archived = ? AND (? IS NULL OR name LIKE '%' || ? || '%' OR path LIKE '%' || ? || '%') ORDER BY updated_at DESC, project_id DESC LIMIT ? OFFSET ?`).all(namespace, archived ? 1 : 0, keyword, keyword, keyword, pageSize, pageOffset(page, pageSize)) as Array<{ project_id: string; name: string; path: string; color: string; archived: number; created_at: string; updated_at: string }>
    const items = rows.map((row) => ({ id: row.project_id, name: row.name, path: row.path, color: row.color, archived: Boolean(row.archived), createdAt: row.created_at, updatedAt: row.updated_at }))
    return { items, total: count, page, pageSize }
  }

  listProjects(namespace: string, archived = false): ProjectRecord[] {
    const rows = this.db.prepare(`
      SELECT project_id, name, path, color, archived, created_at, updated_at
      FROM projects WHERE namespace = ? AND archived = ?
      ORDER BY updated_at DESC, project_id DESC
    `).all(namespace, archived ? 1 : 0) as Array<{ project_id: string; name: string; path: string; color: string; archived: number; created_at: string; updated_at: string }>
    return rows.map((row) => ({ id: row.project_id, name: row.name, path: row.path, color: row.color, archived: Boolean(row.archived), createdAt: row.created_at, updatedAt: row.updated_at }))
  }

  getProjectByPath(namespace: string, path: string): ProjectRecord | null {
    const row = this.db.prepare(`
      SELECT project_id, name, path, color, archived, created_at, updated_at
      FROM projects WHERE namespace = ? AND path = ?
    `).get(namespace, path) as { project_id: string; name: string; path: string; color: string; archived: number; created_at: string; updated_at: string } | undefined
    return row ? { id: row.project_id, name: row.name, path: row.path, color: row.color, archived: Boolean(row.archived), createdAt: row.created_at, updatedAt: row.updated_at } : null
  }

  upsertProject(namespace: string, input: { id: string; name: string; path: string; color: string; createdAt?: string }): ProjectRecord {
    const now = input.createdAt ?? new Date().toISOString()
    // path 上的唯一索引保证同一目录只有一条，重复添加只刷新名称并解除归档。
    this.db.prepare(`
      INSERT INTO projects(namespace, project_id, name, path, color, archived, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(namespace, path) DO UPDATE SET name = excluded.name, archived = 0, updated_at = excluded.updated_at
    `).run(namespace, input.id, input.name, input.path, input.color, now, now)
    return this.getProjectByPath(namespace, input.path) as ProjectRecord
  }

  /** 侧栏工作区按 updated_at 倒序，选中项目、在项目内发消息都算一次操作，靠这里把它顶到最前。 */
  touchProject(namespace: string, id: string): ProjectRecord | null {
    this.db.prepare('UPDATE projects SET updated_at = ? WHERE namespace = ? AND project_id = ?').run(new Date().toISOString(), namespace, id)
    const row = this.db.prepare(`
      SELECT project_id, name, path, color, archived, created_at, updated_at
      FROM projects WHERE namespace = ? AND project_id = ?
    `).get(namespace, id) as { project_id: string; name: string; path: string; color: string; archived: number; created_at: string; updated_at: string } | undefined
    return row ? { id: row.project_id, name: row.name, path: row.path, color: row.color, archived: Boolean(row.archived), createdAt: row.created_at, updatedAt: row.updated_at } : null
  }

  archiveProject(namespace: string, id: string) {
    this.db.prepare('UPDATE projects SET archived = 1 WHERE namespace = ? AND project_id = ?').run(namespace, id)
  }

  removeProject(namespace: string, id: string) {
    // 先清知识库（含 FTS），再删项目；无 FK，顺序不能反。
    this.deps.deleteProjectKbEntries(namespace, id)
    this.db.prepare('DELETE FROM projects WHERE namespace = ? AND project_id = ?').run(namespace, id)
  }

  /** 模型是会话级绑定：打开历史会话要还原成上次用的模型，而不是跟着应用当前选择走。 */
  getConversationModelId(namespace: string, id: string): number | null {
    const row = this.db.prepare('SELECT model_id FROM conversations WHERE namespace = ? AND conversation_id = ?').get(namespace, id) as { model_id: number | null } | undefined
    return row?.model_id ?? null
  }

  setConversationModelId(namespace: string, id: string, modelId: number | null) {
    this.db.prepare('UPDATE conversations SET model_id = ? WHERE namespace = ? AND conversation_id = ?').run(modelId, namespace, id)
  }

  getConversationSessionFile(namespace: string, id: string): string | null {
    const row = this.db.prepare('SELECT session_file FROM conversations WHERE namespace = ? AND conversation_id = ?').get(namespace, id) as { session_file: string | null } | undefined
    return row?.session_file ?? null
  }

  /** 传 null 表示解绑：清空会话时 session 文件会被删掉，指向它的路径必须一并清掉。 */
  setConversationSessionFile(namespace: string, id: string, sessionFile: string | null) {
    this.db.prepare('UPDATE conversations SET session_file = ? WHERE namespace = ? AND conversation_id = ?').run(sessionFile, namespace, id)
  }

  recordToolCall(namespace: string, input: {
    id: string
    conversationId: string
    turnId: string
    runId: string
    toolName: string
    source?: import('../../shared/types').ToolSource | null
    arguments: unknown
    status: ToolCallRecord['status']
    permissionResult?: string
    startedAt?: string
    parentToolCallId?: string
    subAgentId?: string
    subAgentRunId?: string
  }) {
    this.db.prepare(`
      INSERT INTO tool_calls(namespace, id, conversation_id, turn_id, run_id, tool_name, source, arguments_json, status, permission_result, started_at, parent_tool_call_id, sub_agent_id, sub_agent_run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(namespace, input.id, input.conversationId, input.turnId, input.runId, input.toolName, input.source ?? null, JSON.stringify(input.arguments ?? {}), input.status, input.permissionResult ?? null, input.startedAt ?? new Date().toISOString(), input.parentToolCallId ?? null, input.subAgentId ?? null, input.subAgentRunId ?? null)
  }

  updateToolCall(namespace: string, id: string, patch: {
    status?: ToolCallRecord['status']
    result?: unknown
    error?: string | null
    permissionResult?: string | null
    finishedAt?: string
    durationMs?: number
  }) {
    const row = this.db.prepare('SELECT result_json FROM tool_calls WHERE namespace = ? AND id = ?').get(namespace, id) as { result_json: string | null } | undefined
    if (!row) return
    this.db.prepare(`
      UPDATE tool_calls SET
        status = COALESCE(?, status),
        result_json = ?,
        error = ?,
        permission_result = COALESCE(?, permission_result),
        finished_at = COALESCE(?, finished_at),
        duration_ms = COALESCE(?, duration_ms)
      WHERE namespace = ? AND id = ?
    `).run(patch.status ?? null, patch.result === undefined ? row.result_json : JSON.stringify(patch.result), patch.error === undefined ? null : patch.error, patch.permissionResult ?? null, patch.finishedAt ?? null, patch.durationMs ?? null, namespace, id)
  }

  listToolCalls(namespace: string, turnId: string): ToolCallRecord[] {
    const rows = this.db.prepare('SELECT * FROM tool_calls WHERE namespace = ? AND turn_id = ? ORDER BY started_at ASC, id ASC').all(namespace, turnId) as Array<{
      id: string; conversation_id: string; turn_id: string; run_id: string; tool_name: string; source: import('../../shared/types').ToolSource | null; arguments_json: string; result_json: string | null;
      status: ToolCallRecord['status']; permission_result: string | null; started_at: string; finished_at: string | null; duration_ms: number | null; error: string | null
    }>
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      parentToolCallId: (row as { parent_tool_call_id?: string | null }).parent_tool_call_id ?? null,
      subAgentId: (row as { sub_agent_id?: string | null }).sub_agent_id ?? null,
      subAgentRunId: (row as { sub_agent_run_id?: string | null }).sub_agent_run_id ?? null,
      turnId: row.turn_id,
      runId: row.run_id,
      toolName: row.tool_name,
      source: row.source,
      arguments: parseJson(row.arguments_json, {}),
      result: row.result_json === null ? null : parseJson(row.result_json, null),
      status: row.status,
      permissionResult: row.permission_result,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      error: row.error
    }))
  }

  setTodos(namespace: string, conversationId: string, items: TodoItem[]): TodoItem[] {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM session_todos WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      const insert = this.db.prepare('INSERT INTO session_todos(namespace, conversation_id, item_id, content, status, position, phase, phase_position, delegated_task_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const now = new Date().toISOString()
      items.forEach((item, index) => {
        insert.run(namespace, conversationId, item.id, item.content, item.status, item.position ?? index, item.phase ?? null, item.phasePosition ?? 0, item.delegatedTaskId ?? null, now)
      })
    })
    transaction()
    return this.listTodos(namespace, conversationId)
  }

  listTodos(namespace: string, conversationId: string): TodoItem[] {
    const rows = this.db.prepare('SELECT item_id, content, status, position, phase, phase_position, delegated_task_id FROM session_todos WHERE namespace = ? AND conversation_id = ? ORDER BY phase_position ASC, position ASC, item_id ASC').all(namespace, conversationId) as Array<{ item_id: string; content: string; status: TodoItem['status']; position: number; phase: string | null; phase_position: number; delegated_task_id: string | null }>
    return rows.map((row) => ({
      id: row.item_id,
      content: row.content,
      status: row.status,
      position: row.position,
      // 不分组的会话不带这些字段，渲染层据此走扁平路径
      ...(row.phase ? { phase: row.phase, phasePosition: row.phase_position } : {}),
      ...(row.delegated_task_id ? { delegatedTaskId: row.delegated_task_id } : {})
    }))
  }
}
