import type Database from 'better-sqlite3'
import type { AgentFileChange, AgentRunChanges, Artifact, ArtifactQuery, FileOperation, FileVersionRecord } from '../../shared/types'
import { parseJson } from './row-mappers'

/** 撤销一轮改动时需要的单条台账记录。 */
export interface RevertableFileChange {
  path: string
  conversationId: string
  operation: FileOperation
  /** 本轮写完后的哈希；文件被删掉时为 null。和磁盘现状比对，判断之后有没有人再改过。 */
  afterHash: string | null
  /** 本轮第一次写之前的原文；新建文件、二进制与超大文件为 null。 */
  beforeText: string | null
}

/** 成果登记与 Agent 文件变更台账（含 diff 与恢复用原文）。 */
export class ArtifactStore {
  constructor(private readonly db: Database.Database) {}

  /** 单条产物。版本视图与恢复都要先拿到它的 workspaceId 与相对路径。 */
  getArtifact(namespace: string, artifactId: string): Artifact | null {
    const row = this.db.prepare(`
      SELECT artifact_id, workspace_id, conversation_id, task_id, agent_run_id, turn_id, name, type, path, content, size, source, created_at, updated_at
      FROM artifacts WHERE namespace = ? AND artifact_id = ?
    `).get(namespace, artifactId) as {
      artifact_id: string; workspace_id: string; conversation_id: string | null; task_id: string | null
      agent_run_id: string | null; turn_id: string | null; name: string; type: Artifact['type']
      path: string | null; content: string | null; size: number | null; source: string | null
      created_at: number; updated_at: number
    } | undefined
    if (!row) return null
    return {
      id: row.artifact_id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id ?? undefined,
      taskId: row.task_id ?? undefined,
      agentRunId: row.agent_run_id ?? undefined,
      turnId: row.turn_id ?? undefined,
      name: row.name,
      type: row.type,
      path: row.path ?? undefined,
      content: row.content ?? undefined,
      size: row.size ?? undefined,
      source: row.source ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  listArtifacts(namespace: string, query: ArtifactQuery = {}): Artifact[] {
    const keyword = (query.keyword ?? '').trim()
    const rows = this.db.prepare(`
      SELECT artifact_id, workspace_id, conversation_id, task_id, agent_run_id, turn_id, name, type, path, content, size, source, created_at, updated_at
      FROM artifacts
      WHERE namespace = ?
        AND (? IS NULL OR workspace_id = ?)
        AND (? IS NULL OR conversation_id = ?)
        AND (? = '' OR name LIKE ? OR path LIKE ? OR type LIKE ?)
      ORDER BY updated_at DESC, artifact_id DESC
      LIMIT ?
    `).all(
      namespace,
      query.workspaceId ?? null, query.workspaceId ?? null,
      query.conversationId ?? null, query.conversationId ?? null,
      keyword, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`,
      Math.min(Math.max(query.limit ?? 500, 1), 1000)
    ) as Array<{
      artifact_id: string; workspace_id: string; conversation_id: string | null; task_id: string | null
      agent_run_id: string | null; turn_id: string | null; name: string; type: Artifact['type']
      path: string | null; content: string | null; size: number | null; source: string | null
      created_at: number; updated_at: number
    }>
    return rows.map((row) => ({
      id: row.artifact_id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id ?? undefined,
      taskId: row.task_id ?? undefined,
      agentRunId: row.agent_run_id ?? undefined,
      turnId: row.turn_id ?? undefined,
      name: row.name,
      type: row.type,
      path: row.path ?? undefined,
      content: row.content ?? undefined,
      size: row.size ?? undefined,
      source: row.source ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  /** 同一工作区 + 路径 + 会话的写入视为更新：刷新时间戳与内容，不重复登记。 */
  upsertArtifact(namespace: string, input: {
    id: string
    workspaceId: string
    conversationId?: string
    taskId?: string
    agentRunId?: string
    turnId?: string
    name: string
    type: Artifact['type']
    path?: string
    content?: string
    size?: number
    source?: string
    createdAt?: number
  }): Artifact {
    const now = Date.now()
    const existing = this.db.prepare(`
      SELECT artifact_id FROM artifacts
      WHERE namespace = ? AND workspace_id = ? AND path IS ? AND conversation_id IS ?
      LIMIT 1
    `).get(namespace, input.workspaceId, input.path ?? null, input.conversationId ?? null) as { artifact_id: string } | undefined
    const artifactId = existing?.artifact_id ?? input.id
    const createdAt = existing ? this.db.prepare('SELECT created_at FROM artifacts WHERE namespace = ? AND artifact_id = ?').get(namespace, artifactId) as { created_at: number } | undefined : undefined
    this.db.prepare(`
      INSERT INTO artifacts(namespace, artifact_id, workspace_id, conversation_id, task_id, agent_run_id, turn_id, name, type, path, content, size, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, artifact_id) DO UPDATE SET
        name = excluded.name, type = excluded.type, path = excluded.path,
        content = excluded.content, size = excluded.size, source = excluded.source,
        turn_id = excluded.turn_id, agent_run_id = excluded.agent_run_id,
        updated_at = excluded.updated_at
    `).run(
      namespace, artifactId, input.workspaceId, input.conversationId ?? null, input.taskId ?? null,
      input.agentRunId ?? null, input.turnId ?? null, input.name, input.type, input.path ?? null,
      input.content ?? null, input.size ?? null, input.source ?? null,
      createdAt?.created_at ?? input.createdAt ?? now, now
    )
    return this.listArtifacts(namespace, { workspaceId: input.workspaceId, limit: 1000 }).find((item) => item.id === artifactId) as Artifact
  }

  removeArtifact(namespace: string, id: string) {
    this.db.prepare('DELETE FROM artifacts WHERE namespace = ? AND artifact_id = ?').run(namespace, id)
  }

  /**
   * 清空一个会话登记的成果与文件改动记录。
   * 只删登记，不动磁盘上的文件：那些是用户工作区里的真实产出，不该被「清空会话」带走。
   */
  deleteConversationArtifacts(namespace: string, conversationId: string): number {
    const purge = this.db.transaction(() => {
      this.db.prepare('DELETE FROM agent_file_changes WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
      return this.db.prepare('DELETE FROM artifacts WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId).changes
    })
    return purge()
  }

  /**
   * 记录 Agent 对某个文件的最终变更状态。一轮内同一路径只有一条，重复写入直接覆盖：
   * 调用方每次都拿「本轮基线 vs 当前」重算，写进来的就是整轮累计结果，不能再叠加。
   * diff 文本单独存这张表，不进 conversation_turns.activity——那份每次读会话都要整体反序列化。
   */
  upsertFileChange(namespace: string, input: {
    turnId: string
    conversationId: string
    runId: string
    path: string
    operation: FileOperation
    oldPath?: string | null
    additions: number
    deletions: number
    tools: string[]
    beforeHash?: string | null
    afterHash?: string | null
    diff?: string | null
    /** 本轮第一次写入之前的原文；只在首次插入时落库，供成果版本恢复。 */
    beforeText?: string | null
  }) {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO agent_file_changes(namespace, turn_id, path, conversation_id, run_id, operation, old_path, additions, deletions, tools, before_hash, after_hash, diff, before_text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, turn_id, path) DO UPDATE SET
        operation = excluded.operation,
        old_path = COALESCE(excluded.old_path, old_path),
        additions = excluded.additions,
        deletions = excluded.deletions,
        tools = excluded.tools,
        after_hash = excluded.after_hash,
        diff = excluded.diff,
        -- 同一回合里同一个文件可能被写多次，原文只保留第一次那份，
        -- 否则「恢复到本轮之前」会退成上一次写完的样子。
        before_text = COALESCE(before_text, excluded.before_text),
        -- 撤销之后同一轮又写了这个文件：撤销标记已不代表磁盘现状
        reverted_at = NULL,
        updated_at = excluded.updated_at
    `).run(
      namespace, input.turnId, input.path, input.conversationId, input.runId, input.operation,
      input.oldPath ?? null, input.additions, input.deletions, JSON.stringify(input.tools),
      input.beforeHash ?? null, input.afterHash ?? null, input.diff ?? null, input.beforeText ?? null, now, now
    )
  }

  /** 撤销后归零的文件（新建又删掉）不该留在本轮变更里。 */
  removeFileChange(namespace: string, turnId: string, path: string) {
    this.db.prepare('DELETE FROM agent_file_changes WHERE namespace = ? AND turn_id = ? AND path = ?').run(namespace, turnId, path)
  }

  /** 单条变更的原始记录，供合并规则读取上一次状态。 */
  getFileChange(namespace: string, turnId: string, path: string): { operation: FileOperation; tools: string[]; beforeHash: string | null } | null {
    const row = this.db.prepare('SELECT operation, tools, before_hash FROM agent_file_changes WHERE namespace = ? AND turn_id = ? AND path = ?')
      .get(namespace, turnId, path) as { operation: FileOperation; tools: string; before_hash: string | null } | undefined
    if (!row) return null
    return { operation: row.operation, tools: parseJson<string[]>(row.tools, []), beforeHash: row.before_hash }
  }

  /** 一轮的变更聚合，Bar 直接用；diff 文本不在这里返回，按需走 getFileChangeDiff。 */
  listFileChanges(namespace: string, turnId: string): AgentRunChanges {
    const rows = this.db.prepare(`
      SELECT path, operation, old_path, additions, deletions, tools, diff, reverted_at, updated_at
      FROM agent_file_changes WHERE namespace = ? AND turn_id = ?
      ORDER BY updated_at DESC, path ASC
    `).all(namespace, turnId) as Array<{
      path: string; operation: FileOperation; old_path: string | null
      additions: number; deletions: number; tools: string; diff: string | null; reverted_at: number | null; updated_at: number
    }>
    const files: AgentFileChange[] = rows.map((row) => ({
      path: row.path,
      operation: row.operation,
      oldPath: row.old_path ?? undefined,
      additions: row.additions,
      deletions: row.deletions,
      tools: parseJson<string[]>(row.tools, []),
      hasDiff: Boolean(row.diff),
      reverted: row.reverted_at !== null,
      updatedAt: row.updated_at
    }))
    return {
      turnId,
      changedFiles: files.length,
      addedFiles: files.filter((file) => file.operation === 'create').length,
      modifiedFiles: files.filter((file) => file.operation === 'update').length,
      deletedFiles: files.filter((file) => file.operation === 'delete').length,
      renamedFiles: files.filter((file) => file.operation === 'rename').length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      files
    }
  }

  /**
   * 一个文件的改动历史：每一条对应改过它的一个回合。
   * 成果版本视图按它渲染；conversationId 传入时只看该会话，避免把别的会话的历史混进来。
   */
  listFileVersions(namespace: string, path: string, conversationId?: string | null, limit = 50): FileVersionRecord[] {
    const rows = this.db.prepare(`
      SELECT turn_id, run_id, conversation_id, operation, additions, deletions,
             diff IS NOT NULL AS has_diff, before_text IS NOT NULL AS can_restore, updated_at
      FROM agent_file_changes
      WHERE namespace = ? AND path = ? AND (? IS NULL OR conversation_id = ?)
      ORDER BY updated_at DESC LIMIT ?
    `).all(namespace, path, conversationId ?? null, conversationId ?? null, limit) as Array<{
      turn_id: string; run_id: string; conversation_id: string; operation: FileOperation
      additions: number; deletions: number; has_diff: number; can_restore: number; updated_at: number
    }>
    return rows.map((row) => ({
      turnId: row.turn_id,
      runId: row.run_id,
      conversationId: row.conversation_id,
      operation: row.operation,
      additions: row.additions,
      deletions: row.deletions,
      hasDiff: Boolean(row.has_diff),
      canRestore: Boolean(row.can_restore),
      changedAt: row.updated_at
    }))
  }

  /** 恢复用的原文；旧记录没有存过时为 null，调用方据此禁用恢复入口。 */
  getFileChangeBeforeText(namespace: string, turnId: string, path: string): string | null {
    const row = this.db.prepare('SELECT before_text FROM agent_file_changes WHERE namespace = ? AND turn_id = ? AND path = ?')
      .get(namespace, turnId, path) as { before_text: string | null } | undefined
    return row?.before_text ?? null
  }

  /** 撤销要用的原始记录：只取还没撤销过的，原文与改后哈希都带上，供写回与冲突判断。 */
  listRevertableFileChanges(namespace: string, turnId: string): RevertableFileChange[] {
    const rows = this.db.prepare(`
      SELECT path, conversation_id, operation, after_hash, before_text
      FROM agent_file_changes WHERE namespace = ? AND turn_id = ? AND reverted_at IS NULL
      ORDER BY path ASC
    `).all(namespace, turnId) as Array<{ path: string; conversation_id: string; operation: FileOperation; after_hash: string | null; before_text: string | null }>
    return rows.map((row) => ({ path: row.path, conversationId: row.conversation_id, operation: row.operation, afterHash: row.after_hash, beforeText: row.before_text }))
  }

  markFileChangesReverted(namespace: string, turnId: string, paths: string[]) {
    if (!paths.length) return
    const statement = this.db.prepare('UPDATE agent_file_changes SET reverted_at = ? WHERE namespace = ? AND turn_id = ? AND path = ?')
    const now = Date.now()
    this.db.transaction(() => { for (const path of paths) statement.run(now, namespace, turnId, path) })()
  }

  getFileChangeDiff(namespace: string, turnId: string, path: string): string | null {
    const row = this.db.prepare('SELECT diff FROM agent_file_changes WHERE namespace = ? AND turn_id = ? AND path = ?')
      .get(namespace, turnId, path) as { diff: string | null } | undefined
    return row?.diff ?? null
  }

  relocateArtifact(namespace: string, id: string, path: string, name: string) {
    this.db.prepare('UPDATE artifacts SET path = ?, name = ? WHERE namespace = ? AND artifact_id = ?').run(path, name, namespace, id)
  }
}
