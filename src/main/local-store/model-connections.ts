import type Database from 'better-sqlite3'
import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Credential, CredentialStore } from '@earendil-works/pi-ai'
import type { LocalModelSummary, ModelConnectionDraft, ModelConnectionInput, ModelConnectionSummary, ModelCredentials } from '../../shared/types'
import { modelProvider, normalizeConnectionEndpoint } from '../../shared/model-providers'

export const MODEL_CONNECTIONS_SQL = `CREATE TABLE IF NOT EXISTS model_connections (
  id TEXT PRIMARY KEY, payload TEXT NOT NULL, secrets BLOB, updated_at TEXT NOT NULL
);`

type Metadata = Omit<ModelConnectionSummary, 'id' | 'models' | 'hasCredentials' | 'status' | 'updatedAt'>
type Row = { id: string; payload: string; secrets: Buffer | null; updated_at: string }
type Secrets = { api_key?: string; headers?: Record<string, string>; credential?: Credential }

/**
 * 旧版每条 local_models 都是独立连接。迁移只搬密文，不解密也不重新加密，
 * 这样系统加密不可用时仍能启动，且凭据不会短暂出现在 JS 内存中。
 */
export function migrateLegacyLocalModels(db: Database.Database): void {
  // 不用 json_extract 过滤：损坏的历史 JSON 会让 SQLite 直接中止整条查询。
  const rows = (db.prepare('SELECT id, payload, secrets, updated_at FROM local_models').all() as Array<{ id: number; payload: string; secrets: Buffer | null; updated_at: string }>).filter((row) => {
    try {
      const parsed = JSON.parse(row.payload) as unknown
      return !parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('connectionId' in parsed) || !(parsed as { connectionId?: unknown }).connectionId
    } catch {
      return false
    }
  })
  if (!rows.length) return
  const insert = db.prepare('INSERT INTO model_connections(id, payload, secrets, updated_at) VALUES (?, ?, ?, ?)')
  const update = db.prepare('UPDATE local_models SET payload = ?, secrets = NULL WHERE id = ?')
  const migrate = db.transaction(() => {
    for (const row of rows) {
      let source: Record<string, unknown>
      try {
        const parsed = JSON.parse(row.payload) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
        source = parsed as Record<string, unknown>
      } catch {
        continue
      }
      const modelName = typeof source.model_name === 'string' ? source.model_name.trim() : ''
      if (!modelName) continue
      const baseUrl = typeof source.base_url === 'string' ? source.base_url.trim().replace(/\/+$/, '') : ''
      const protocol = source.protocol === 'anthropic' || source.protocol === 'openai-responses' || source.protocol === 'openai' ? source.protocol : 'openai'
      const displayName = typeof source.name === 'string' && source.name.trim()
        ? source.name.trim()
        : typeof source.provider === 'string' && source.provider.trim() ? source.provider.trim() : modelName
      const connectionId = randomUUID()
      const metadata: Metadata = { providerId: 'custom', name: displayName, authMode: 'api-key', baseUrl, protocol }
      insert.run(connectionId, JSON.stringify(metadata), row.secrets, row.updated_at)
      update.run(JSON.stringify({ ...source, connectionId, provider: displayName, protocol, base_url: baseUrl, model_name: modelName, supports_thinking: typeof source.supports_thinking === 'boolean' ? source.supports_thinking : true }), row.id)
    }
  })
  migrate()
}

export class ModelConnectionStore {
  private readonly locks = new Map<string, Promise<unknown>>()
  constructor(private readonly db: Database.Database) {}

  private row(id: string): Row {
    const row = this.db.prepare('SELECT * FROM model_connections WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error('模型连接不存在')
    return row
  }

  metadata(id: string): Metadata { return JSON.parse(this.row(id).payload) as Metadata }

  private secrets(id: string): Secrets {
    const row = this.row(id)
    if (!row.secrets) return {}
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法读取连接凭据')
    try { return JSON.parse(safeStorage.decryptString(row.secrets)) as Secrets } catch { throw new Error('连接凭据无法解密，请重新登录或填写密钥') }
  }

  private encrypt(secrets: Secrets): Buffer | null {
    if (!Object.keys(secrets).length) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，不能保存连接凭据')
    return safeStorage.encryptString(JSON.stringify(secrets))
  }

  private writeSecrets(id: string, secrets: Secrets): void {
    const result = this.db.prepare('UPDATE model_connections SET secrets = ?, updated_at = ? WHERE id = ?').run(this.encrypt(secrets), new Date().toISOString(), id)
    if (!result.changes) throw new Error('模型连接不存在')
  }

  list(): ModelConnectionSummary[] {
    const models = this.listModels()
    return (this.db.prepare('SELECT * FROM model_connections ORDER BY updated_at,id').all() as Row[]).map((row) => ({
      ...JSON.parse(row.payload) as Metadata, id: row.id, hasCredentials: Boolean(row.secrets), status: row.secrets ? 'ready' : 'unauthenticated', models: models.filter((m) => m.connectionId === row.id), updatedAt: row.updated_at
    }))
  }

  listModels(): LocalModelSummary[] {
    // CASE 防止历史损坏 JSON 让 SQLite 在 json_extract 处中止查询。
    const rows = this.db.prepare('SELECT m.id,m.payload,m.updated_at,c.id AS connection_id,c.payload AS connection_payload,c.secrets IS NOT NULL AS has_credentials FROM local_models m JOIN model_connections c ON c.id = CASE WHEN json_valid(m.payload) THEN json_extract(m.payload,\'$.connectionId\') END ORDER BY m.id').all() as { id: number; payload: string; updated_at: string; connection_id: string; connection_payload: string; has_credentials: number }[]
    return rows.map((row) => {
      const metadata = JSON.parse(row.connection_payload) as Metadata
      const payload = JSON.parse(row.payload) as Record<string, unknown>
      return { ...payload, id: -row.id, connectionId: row.connection_id, provider: modelProvider(metadata.providerId).name, authMode: metadata.authMode, protocol: metadata.protocol, base_url: metadata.baseUrl, supports_thinking: typeof payload.supports_thinking === 'boolean' ? payload.supports_thinking : true, hasApiKey: Boolean(row.has_credentials), updatedAt: row.updated_at } as LocalModelSummary
    })
  }

  resolve(input: ModelConnectionDraft): { metadata: Metadata; secrets: Secrets } {
    const provider = modelProvider(input.providerId)
    if (!provider.authModes.includes(input.authMode)) throw new Error('该厂商不支持此登录方式')
    const previous = input.id ? this.metadata(input.id) : undefined
    if (previous && (previous.providerId !== input.providerId || previous.authMode !== input.authMode)) throw new Error('连接厂商和认证方式不可修改，请新建连接')
    const baseUrl = input.authMode === 'oauth' ? provider.baseUrl : normalizeConnectionEndpoint(input.baseUrl ?? previous?.baseUrl ?? provider.baseUrl)
    const destinationChanged = previous && baseUrl !== previous.baseUrl
    if (destinationChanged && !input.apiKey?.trim()) throw new Error('服务地址已改变，请重新填写密钥以确认新的发送目标')
    const secrets: Secrets = input.id && !destinationChanged ? this.secrets(input.id) : {}
    if (input.apiKey?.trim()) secrets.api_key = input.apiKey.trim()
    if (input.headers !== undefined) secrets.headers = input.headers
    return { metadata: { providerId: provider.id, name: input.name?.trim() || previous?.name || provider.name, authMode: input.authMode, baseUrl, protocol: input.protocol ?? previous?.protocol ?? provider.protocol }, secrets }
  }

  save(input: ModelConnectionInput): ModelConnectionSummary {
    const { metadata, secrets } = this.resolve(input)
    const id = input.id ?? randomUUID()
    const seen = new Set<string>()
    for (const model of input.models) {
      if (!model.modelId.trim() || seen.has(model.modelId.trim())) throw new Error('模型标识不能为空或重复')
      seen.add(model.modelId.trim())
    }
    const encrypted = this.encrypt(secrets)
    this.db.transaction(() => {
      const now = new Date().toISOString()
      this.db.prepare('INSERT INTO model_connections(id,payload,secrets,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,secrets=excluded.secrets,updated_at=excluded.updated_at').run(id, JSON.stringify(metadata), encrypted, now)
      const existing = this.db.prepare("SELECT id,payload FROM local_models WHERE CASE WHEN json_valid(payload) THEN json_extract(payload,'$.connectionId') END = ?").all(id) as { id: number; payload: string }[]
      const kept = new Set<number>()
      for (const model of input.models) {
        const old = model.id === undefined ? existing.find((m) => JSON.parse(m.payload).model_name === model.modelId) : existing.find((m) => m.id === -model.id!)
        if (model.id !== undefined && !old) throw new Error('模型不属于该连接')
        const payload = { ...(old ? JSON.parse(old.payload) : {}), connectionId: id, name: model.name?.trim() || model.modelId.trim(), provider: modelProvider(metadata.providerId).name, protocol: metadata.protocol, model_name: model.modelId.trim(), model_kind: 'chat', base_url: metadata.baseUrl, context_window: model.contextWindow, max_tokens: model.maxTokens, supports_thinking: model.reasoning ?? true }
        if (old) { this.db.prepare('UPDATE local_models SET payload=?,secrets=NULL,updated_at=? WHERE id=?').run(JSON.stringify(payload), now, old.id); kept.add(old.id) }
        else kept.add(Number(this.db.prepare('INSERT INTO local_models(payload,secrets,updated_at) VALUES(?,NULL,?)').run(JSON.stringify(payload), now).lastInsertRowid))
      }
      for (const old of existing) if (!kept.has(old.id)) this.db.prepare('DELETE FROM local_models WHERE id=?').run(old.id)
    })()
    return this.list().find((item) => item.id === id)!
  }

  remove(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM local_models WHERE CASE WHEN json_valid(payload) THEN json_extract(payload,'$.connectionId') END = ?").run(id)
      this.db.prepare('DELETE FROM model_connections WHERE id = ?').run(id)
    })()
  }

  runtimeConfig(dbId: number): Omit<ModelCredentials, 'id'> | null {
    const row = this.db.prepare('SELECT payload FROM local_models WHERE id=?').get(dbId) as { payload: string } | undefined
    if (!row) return null
    const payload = JSON.parse(row.payload)
    if (!payload.connectionId) return null
    const metadata = this.metadata(payload.connectionId)
    const secrets = this.secrets(payload.connectionId)
    return { ...payload, provider: modelProvider(metadata.providerId).name, base_url: metadata.baseUrl, protocol: metadata.protocol, api_key: secrets.api_key ?? '', headers: secrets.headers, authMode: metadata.authMode, oauthProviderId: modelProvider(metadata.providerId).oauthProviderId, supports_thinking: typeof payload.supports_thinking === 'boolean' ? payload.supports_thinking : true }
  }

  credentials(id: string): CredentialStore {
    const providerId = modelProvider(this.metadata(id).providerId).oauthProviderId
    const check = (provider: string) => { if (provider !== providerId) throw new Error('凭据提供商不匹配') }
    const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
      const task = (this.locks.get(id) ?? Promise.resolve()).catch(() => {}).then(fn)
      this.locks.set(id, task)
      void task.finally(() => { if (this.locks.get(id) === task) this.locks.delete(id) }).catch(() => {})
      return task
    }
    return {
      read: async (provider) => { if (provider !== providerId) return undefined; return this.secrets(id).credential },
      list: async () => { const credential = this.secrets(id).credential; return credential && providerId ? [{ providerId, type: credential.type }] : [] },
      modify: (provider, fn) => serialize(async () => { check(provider); const secrets = this.secrets(id); const next = await fn(secrets.credential); if (next) this.writeSecrets(id, { ...secrets, credential: next }); return next ?? secrets.credential }),
      delete: (provider) => serialize(async () => { check(provider); const secrets = this.secrets(id); delete secrets.credential; this.writeSecrets(id, secrets) })
    }
  }
}
