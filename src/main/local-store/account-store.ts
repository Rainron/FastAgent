import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ModelCredentials } from '../../shared/types'

export interface StoredSession {
  backendUrl: string
  userId: string
  refreshToken: string | null
  /** 只在登录/恢复时拿得到；session 目录的用户段用它。 */
  username?: string | null
}

export interface OutboxItem {
  id: string
  namespace: string
  payload: unknown
  attempts: number
  nextAttemptAt: string
}

/** 账号命名空间：backendUrl + userId，落库的所有行都按它隔离。 */
export function storeNamespace(backendUrl: string, userId: string) {
  return `${backendUrl.replace(/\/$/, '').toLowerCase()}::${userId}`
}

/** 账号会话、资源缓存、模型凭证与离线发件箱。 */
export class AccountStore {
  constructor(private readonly db: Database.Database) {}

  saveAccount(session: StoredSession) {
    const namespace = storeNamespace(session.backendUrl, session.userId)
    const encrypted = session.refreshToken && safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(session.refreshToken)
      : null
    // 续期回调拿不到 username，用 COALESCE 保住已有值，避免刷新一次就把 session 路径的用户段抹回 userId。
    this.db.prepare(`
      INSERT INTO accounts(namespace, backend_url, user_id, refresh_token, username, locked, updated_at)
      VALUES (@namespace, @backendUrl, @userId, @refreshToken, @username, 0, @updatedAt)
      ON CONFLICT(namespace) DO UPDATE SET refresh_token=excluded.refresh_token, username=COALESCE(excluded.username, accounts.username), locked=0, updated_at=excluded.updated_at
    `).run({ namespace, backendUrl: session.backendUrl, userId: session.userId, refreshToken: encrypted, username: session.username ?? null, updatedAt: new Date().toISOString() })
  }

  getAccountUsername(namespace: string): string | null {
    const row = this.db.prepare('SELECT username FROM accounts WHERE namespace = ?').get(namespace) as { username: string | null } | undefined
    return row?.username ?? null
  }

  getSessionLayoutVersion(namespace: string): number {
    const row = this.db.prepare('SELECT session_layout_version FROM accounts WHERE namespace = ?').get(namespace) as { session_layout_version: number } | undefined
    return row?.session_layout_version ?? 0
  }

  setSessionLayoutVersion(namespace: string, version: number) {
    this.db.prepare('UPDATE accounts SET session_layout_version = ? WHERE namespace = ?').run(version, namespace)
  }

  /** session 目录迁移用：只取路径相关的三列，不碰整段历史。 */
  listConversationSessionBindings(namespace: string): Array<{ conversationId: string; createdAt: string; sessionFile: string | null }> {
    const rows = this.db.prepare('SELECT conversation_id, created_at, session_file FROM conversations WHERE namespace = ?').all(namespace) as Array<{ conversation_id: string; created_at: string; session_file: string | null }>
    return rows.map((row) => ({ conversationId: row.conversation_id, createdAt: row.created_at, sessionFile: row.session_file }))
  }

  lock(namespace: string) {
    this.db.prepare('UPDATE accounts SET locked = 1, updated_at = ? WHERE namespace = ?').run(new Date().toISOString(), namespace)
  }

  getLatestAccount(): StoredSession | null {
    const row = this.db.prepare('SELECT * FROM accounts ORDER BY updated_at DESC LIMIT 1').get() as { backend_url: string; user_id: string; refresh_token: Buffer | null; locked: number } | undefined
    if (!row || !row.refresh_token || row.locked || !safeStorage.isEncryptionAvailable()) return null
    try {
      return { backendUrl: row.backend_url, userId: row.user_id, refreshToken: safeStorage.decryptString(row.refresh_token) }
    } catch {
      return null
    }
  }

  saveResources(backendUrl: string, userId: string, resources: Record<string, unknown>) {
    const namespace = storeNamespace(backendUrl, userId)
    const statement = this.db.prepare(`
      INSERT INTO resource_cache(namespace, kind, resource_id, payload, updated_at)
      VALUES (@namespace, @kind, @resourceId, @payload, @updatedAt)
      ON CONFLICT(namespace, kind, resource_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
    `)
    const now = new Date().toISOString()
    const transaction = this.db.transaction(() => {
      for (const [kind, payload] of Object.entries(resources)) {
        statement.run({ namespace, kind, resourceId: 'bootstrap', payload: JSON.stringify(payload), updatedAt: now })
      }
    })
    transaction()
  }

  /** 模型密钥只以 safeStorage 密文落盘；系统不支持加密时不落盘，本次会话仅靠内存缓存。 */
  saveModelCredentials(namespace: string, credentials: ModelCredentials[]) {
    if (!safeStorage.isEncryptionAvailable()) return false
    const statement = this.db.prepare(`
      INSERT INTO model_credentials(namespace, model_id, payload, updated_at)
      VALUES (@namespace, @modelId, @payload, @updatedAt)
      ON CONFLICT(namespace, model_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
    `)
    const now = new Date().toISOString()
    const keep = credentials.map((item) => item.id)
    this.db.transaction(() => {
      for (const credential of credentials) {
        statement.run({ namespace, modelId: credential.id, payload: safeStorage.encryptString(JSON.stringify(credential)), updatedAt: now })
      }
      // 服务端撤销授权的模型，本地凭证同步清掉，避免离线继续可用。
      const placeholders = keep.map(() => '?').join(',')
      this.db.prepare(`DELETE FROM model_credentials WHERE namespace = ?${keep.length ? ` AND model_id NOT IN (${placeholders})` : ''}`).run(namespace, ...keep)
    })()
    return true
  }

  listModelCredentials(namespace: string): ModelCredentials[] {
    if (!safeStorage.isEncryptionAvailable()) return []
    const rows = this.db.prepare('SELECT model_id, payload FROM model_credentials WHERE namespace = ?').all(namespace) as Array<{ model_id: number; payload: Buffer }>
    const result: ModelCredentials[] = []
    for (const row of rows) {
      try { result.push(JSON.parse(safeStorage.decryptString(row.payload)) as ModelCredentials) }
      catch { /* 换机器或换用户后解不开，等下次登录重新下发 */ }
    }
    return result
  }

  clearModelCredentials(namespace: string) {
    this.db.prepare('DELETE FROM model_credentials WHERE namespace = ?').run(namespace)
  }

  loadResources(backendUrl: string, userId: string): Record<string, unknown> | null {
    const namespace = storeNamespace(backendUrl, userId)
    const rows = this.db.prepare('SELECT kind, payload FROM resource_cache WHERE namespace = ?').all(namespace) as Array<{ kind: string; payload: string }>
    if (!rows.length) return null
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      try { result[row.kind] = JSON.parse(row.payload) } catch { /* 忽略损坏缓存，等待下次在线刷新 */ }
    }
    return Object.keys(result).length ? result : null
  }

  enqueueOutbox(namespace: string, payload: unknown, id = randomUUID()) {
    this.db.prepare('INSERT INTO outbox(id, namespace, payload, attempts, next_attempt_at) VALUES (?, ?, ?, 0, ?)').run(id, namespace, JSON.stringify(payload), new Date().toISOString())
    return id
  }

  listDueOutbox(namespace: string, limit = 20): OutboxItem[] {
    const rows = this.db.prepare('SELECT * FROM outbox WHERE namespace = ? AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?').all(namespace, new Date().toISOString(), limit) as Array<{ id: string; namespace: string; payload: string; attempts: number; next_attempt_at: string }>
    return rows.map((row) => ({ id: row.id, namespace: row.namespace, payload: JSON.parse(row.payload), attempts: row.attempts, nextAttemptAt: row.next_attempt_at }))
  }

  markOutboxAttempt(id: string, attempts: number, nextAttemptAt: string) {
    this.db.prepare('UPDATE outbox SET attempts = ?, next_attempt_at = ? WHERE id = ?').run(attempts, nextAttemptAt, id)
  }

  removeOutbox(id: string) {
    this.db.prepare('DELETE FROM outbox WHERE id = ?').run(id)
  }
}
