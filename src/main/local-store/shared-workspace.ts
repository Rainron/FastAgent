import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

export const WORKSPACE_NAMESPACE = 'desktop:workspace'
export const WORKSPACE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS workspace_model_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_namespace TEXT NOT NULL,
    remote_model_id INTEGER NOT NULL,
    UNIQUE(account_namespace, remote_model_id)
  );
`

export function accountModelId(db: Database.Database, namespace: string, remoteId: number): number {
  if (remoteId <= 0) return remoteId
  const row = db.prepare('SELECT id FROM workspace_model_refs WHERE account_namespace = ? AND remote_model_id = ?').get(namespace, remoteId) as { id: number } | undefined
  if (row) return row.id
  return Number(db.prepare('INSERT INTO workspace_model_refs(account_namespace,remote_model_id) VALUES (?,?)').run(namespace, remoteId).lastInsertRowid)
}

const tables = [
  'projects', 'conversations', 'conversation_run_states', 'conversation_messages', 'conversation_turns',
  'conversation_context_policy', 'conversation_context_state', 'conversation_model_runtime',
  'conversation_summaries', 'conversation_compactions', 'tool_calls', 'session_todos',
  'permission_profiles', 'permission_rules', 'artifacts', 'agent_file_changes', 'agent_runs', 'agent_tasks', 'memories'
] as const
const identityColumns = new Set([
  'conversation_id', 'turn_id', 'message_id', 'run_id', 'task_id', 'item_id', 'artifact_id', 'memory_id',
  'source_conversation_id', 'source_turn_id', 'source_run_id', 'parent_tool_call_id', 'sub_agent_run_id',
  'agent_run_id', 'delegated_task_id', 'covered_turn_start', 'covered_turn_end', 'summary_id', 'latest_summary_id', 'superseded_by', 'id'
])
const jsonIdentityKeys = new Set([
  'conversationId', 'turnId', 'runId', 'taskId', 'toolCallId', 'parentToolCallId', 'subAgentRunId',
  'summaryId', 'artifactId', 'eventId', 'stepId', 'activeStepId', 'activeEventId', 'activeThinkingId'
])
const jsonColumns = new Set(['activity', 'runtime_config', 'citations', 'artifacts'])
type Row = Record<string, string | number | Buffer | null>

/** 保留旧命名空间作为迁移副本，避免改写或搬动原有会话文件。 */
export function migrateSharedWorkspace(db: Database.Database) {
  const sources = db.prepare(`SELECT DISTINCT namespace FROM (${tables.map((table) => `SELECT namespace FROM ${table}`).join(' UNION ALL ')}) WHERE namespace != ? ORDER BY namespace`).all(WORKSPACE_NAMESPACE) as Array<{ namespace: string }>
  const migrate = db.transaction(() => {
    for (const { namespace } of sources) {
      const prefix = `legacy-${createHash('sha256').update(namespace).digest('hex').slice(0, 20)}-`
      const remap = (value: string) => `${prefix}${value}`
      const projectIds = new Map<string, string>()
      const customProfiles = new Set((db.prepare('SELECT profile_id FROM permission_profiles WHERE namespace=? AND builtin=0').all(namespace) as Array<{ profile_id: string }>).map((row) => row.profile_id))
      const remapJson = (value: unknown, key = ''): unknown => {
        if (typeof value === 'number' && key === 'modelId') return accountModelId(db, namespace, value)
        if (typeof value === 'string') {
          if (key === 'projectId') return projectIds.get(value) ?? value
          if (key === 'permission' && customProfiles.has(value)) return remap(value)
          if (jsonIdentityKeys.has(key)) return remap(value)
          return value
        }
        if (Array.isArray(value)) return value.map((entry) => remapJson(entry, key))
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, remapJson(child, childKey)]))
        return value
      }
      for (const table of tables) {
        const rows = db.prepare(`SELECT * FROM ${table} WHERE namespace = ?`).all(namespace) as Row[]
        if (!rows.length) continue
        const columns = Object.keys(rows[0])
        const insert = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
        for (const source of rows) {
          const row: Row = { ...source, namespace: WORKSPACE_NAMESPACE }
          if (table === 'projects') {
            const existing = db.prepare('SELECT project_id FROM projects WHERE namespace=? AND path=?').get(WORKSPACE_NAMESPACE, row.path) as { project_id: string } | undefined
            const id = existing?.project_id ?? remap(String(row.project_id))
            projectIds.set(String(source.project_id), id)
            if (existing) continue
            row.project_id = id
          } else if (typeof row.project_id === 'string') row.project_id = projectIds.get(row.project_id) ?? row.project_id
          for (const column of columns) {
            const value = row[column]
            if (typeof value === 'string' && identityColumns.has(column)) row[column] = remap(value)
            if (column === 'model_id' && typeof value === 'number') row[column] = accountModelId(db, namespace, value)
            if (jsonColumns.has(column) && typeof value === 'string') row[column] = JSON.stringify(remapJson(JSON.parse(value)))
          }
          if (table === 'permission_profiles') {
            if (!row.builtin) row.profile_id = remap(String(row.profile_id))
            else if (db.prepare('SELECT 1 FROM permission_profiles WHERE namespace=? AND profile_id=?').get(WORKSPACE_NAMESPACE, row.profile_id)) continue
          }
          if (table === 'permission_rules') {
            const existing = db.prepare('SELECT action FROM permission_rules WHERE namespace=? AND tool_key=? AND pattern=?').get(WORKSPACE_NAMESPACE, row.tool_key, row.pattern) as { action: string } | undefined
            if (existing) {
              // 合并历史规则时不能因另一个账号的宽松配置扩大执行权限。
              const rank: Record<string, number> = { allow: 0, ask: 1, deny: 2 }
              if (rank[String(row.action)] > rank[existing.action]) db.prepare('UPDATE permission_rules SET action=? WHERE namespace=? AND tool_key=? AND pattern=?').run(row.action, WORKSPACE_NAMESPACE, row.tool_key, row.pattern)
              continue
            }
          }
          const result = insert.run(...columns.map((column) => row[column]))
          if (table === 'memories') db.prepare('INSERT INTO memories_fts(rowid,content) VALUES (?,?)').run(result.lastInsertRowid, row.content)
        }
      }
    }
    const preferences = db.prepare("SELECT scope,payload,updated_at FROM client_preferences WHERE scope NOT IN ('global',?) ORDER BY updated_at DESC LIMIT 1").get(WORKSPACE_NAMESPACE) as { scope: string; payload: string; updated_at: string } | undefined
    if (preferences && !db.prepare('SELECT 1 FROM client_preferences WHERE scope=?').get(WORKSPACE_NAMESPACE)) {
      const payload = JSON.parse(preferences.payload) as Record<string, unknown>
      for (const key of ['selectedModelId', 'favoriteModelIds', 'recentModelIds']) {
        const value = payload[key]
        if (typeof value === 'number') payload[key] = accountModelId(db, preferences.scope, value)
        else if (Array.isArray(value)) payload[key] = value.map((id) => typeof id === 'number' ? accountModelId(db, preferences.scope, id) : id)
      }
      db.prepare('INSERT INTO client_preferences(scope,payload,updated_at) VALUES (?,?,?)').run(WORKSPACE_NAMESPACE, JSON.stringify(payload), preferences.updated_at)
    }
  })
  migrate()
}
