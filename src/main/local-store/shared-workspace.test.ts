import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { applyMigrations, SCHEMA_SQL } from './schema'

const databases: Database.Database[] = []
const workspace = 'desktop:workspace'
function legacy() {
  const db = new Database(':memory:')
  databases.push(db)
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  db.pragma('user_version = 3')
  return db
}
function seed(db: Database.Database, namespace: string, modelId = 7) {
  db.prepare('INSERT INTO projects(namespace, project_id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(namespace, 'project', namespace, 'K:/same-project', '2026-01-01', '2026-01-01')
  db.prepare('INSERT INTO conversations(namespace, conversation_id, title, project_id, model_id, session_file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(namespace, 'conversation', namespace, 'project', modelId, `K:/sessions/${namespace}/old.jsonl`, '2026-01-01', '2026-01-01')
  db.prepare('INSERT INTO conversation_turns(namespace,conversation_id,turn_id,user_message,runtime_config,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(namespace, 'conversation', 'turn', JSON.stringify({ text: '保留原文', createdAt: '2026-01-01' }), JSON.stringify({ modelId, mode: 'chat' }), 'completed', '2026-01-01', '2026-01-01')
}
afterEach(() => { for (const db of databases.splice(0)) db.close() })

describe('统一工作区升级', () => {
  it('合并不同账号的同名会话，保持项目和轮次引用且保留旧记录', () => {
    const db = legacy()
    seed(db, 'server::alice')
    seed(db, 'server::bob')
    applyMigrations(db)
    const conversations = db.prepare('SELECT * FROM conversations WHERE namespace = ? ORDER BY title').all(workspace) as Array<Record<string, unknown>>
    expect(conversations).toHaveLength(2)
    expect(new Set(conversations.map((row) => row.conversation_id)).size).toBe(2)
    expect(new Set(conversations.map((row) => row.project_id)).size).toBe(1)
    expect(conversations.map((row) => row.session_file)).toEqual(['K:/sessions/server::alice/old.jsonl', 'K:/sessions/server::bob/old.jsonl'])
    const turns = db.prepare('SELECT * FROM conversation_turns WHERE namespace = ?').all(workspace) as Array<Record<string, unknown>>
    expect(turns).toHaveLength(2)
    expect(turns.every((turn) => conversations.some((conversation) => turn.conversation_id === conversation.conversation_id))).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS count FROM conversations WHERE namespace != ?').get(workspace)).toEqual({ count: 2 })
    expect(db.pragma('foreign_key_check')).toEqual([])
    applyMigrations(db)
    expect(db.prepare('SELECT COUNT(*) AS count FROM conversations WHERE namespace = ?').get(workspace)).toEqual({ count: 2 })
  })

  it('不同账号相同云端模型编号被映射为不同本机编号，本地负数编号保持不变', () => {
    const db = legacy()
    seed(db, 'server::alice')
    seed(db, 'server::bob')
    seed(db, 'server::local', -12)
    applyMigrations(db)
    const rows = db.prepare('SELECT title, model_id FROM conversations WHERE namespace = ? ORDER BY title').all(workspace) as Array<{ title: string; model_id: number }>
    expect(rows).toHaveLength(3)
    expect(rows[0].model_id).not.toBe(rows[1].model_id)
    expect(rows[2].model_id).toBe(-12)
    const turns = db.prepare('SELECT runtime_config FROM conversation_turns WHERE namespace = ?').all(workspace) as Array<{ runtime_config: string }>
    expect(new Set(turns.map((row) => JSON.parse(row.runtime_config).modelId))).toEqual(new Set(rows.map((row) => row.model_id)))
  })

  it('保留最新工作偏好并将记忆及其来源迁入统一空间', () => {
    const db = legacy()
    seed(db, 'server::alice')
    db.prepare('INSERT INTO client_preferences VALUES (?, ?, ?)').run('server::alice', JSON.stringify({ selectedModelId: 7, favoriteModelIds: [7, -2], modePrompts: { chat: '自定义提示' } }), '2026-09-01')
    db.prepare('INSERT INTO memories(namespace,memory_id,scope,type,content,source_conversation_id,source_turn_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('server::alice', 'memory', 'global', 'preference', '始终使用中文回复', 'conversation', 'turn', 1, 1)
    applyMigrations(db)
    const preference = db.prepare('SELECT payload FROM client_preferences WHERE scope = ?').get(workspace) as { payload: string } | undefined
    expect(preference).toBeDefined()
    expect(JSON.parse(preference!.payload).modePrompts).toEqual({ chat: '自定义提示' })
    const memory = db.prepare('SELECT * FROM memories WHERE namespace = ?').get(workspace) as Record<string, unknown> | undefined
    expect(memory?.content).toBe('始终使用中文回复')
    expect(db.prepare('SELECT conversation_id FROM conversations WHERE namespace=? AND conversation_id=?').get(workspace, memory?.source_conversation_id)).toBeDefined()
    expect(db.prepare("SELECT COUNT(*) AS count FROM memories_fts WHERE memories_fts MATCH '中文回复'").get()).toEqual({ count: 1 })
  })
})
