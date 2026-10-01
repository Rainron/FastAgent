import { safeStorage } from 'electron'
import type Database from 'better-sqlite3'
import type { HubSource, HubSourceInput, HubSourceKind } from '../../shared/types'
import { parseJson } from './row-mappers'

/** 能力市场的源配置；apiKey 与 MCP 密钥同一条加密路径。 */
export class HubSourceStore {
  constructor(private readonly db: Database.Database) {}

  listHubSources(): HubSource[] {
    const rows = this.db.prepare('SELECT id, kind, payload, secrets, enabled, sort_order, updated_at FROM ability_sources ORDER BY sort_order ASC, id ASC')
      .all() as Array<{ id: string; kind: HubSourceKind; payload: string; secrets: Buffer | null; enabled: number; sort_order: number; updated_at: string }>
    return rows.map((row) => ({
      ...parseJson<Omit<HubSource, 'id' | 'kind' | 'enabled' | 'sortOrder' | 'hasSecrets' | 'updatedAt'>>(row.payload, {} as never),
      id: row.id,
      kind: row.kind,
      enabled: row.enabled === 1,
      sortOrder: row.sort_order,
      hasSecrets: Boolean(row.secrets),
      updatedAt: row.updated_at
    }))
  }

  /** apiKey 走 secrets BLOB，与 MCP 密钥同一条加密路径；未传 apiKey 时保留原值。 */
  saveHubSource(input: HubSourceInput & { builtin?: boolean; status?: HubSource['status']; statusMessage?: string | null; checkedAt?: string }): HubSource {
    const existing = this.db.prepare('SELECT secrets FROM ability_sources WHERE id = ?').get(input.id) as { secrets: Buffer | null } | undefined
    let encrypted = existing?.secrets ?? null
    if (input.apiKey !== undefined) {
      const value = input.apiKey.trim()
      if (value && !safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，不能保存源的 API Key')
      encrypted = value ? safeStorage.encryptString(value) : null
    }
    const previous = this.listHubSources().find((item) => item.id === input.id)
    const payload = {
      name: input.name,
      url: input.url,
      ref: input.ref,
      builtin: input.builtin ?? previous?.builtin ?? false,
      status: input.status ?? previous?.status ?? 'untested',
      statusMessage: input.statusMessage ?? previous?.statusMessage ?? null,
      checkedAt: input.checkedAt ?? previous?.checkedAt
    }
    this.db.prepare(`
      INSERT INTO ability_sources(id, kind, payload, secrets, enabled, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, payload = excluded.payload, secrets = excluded.secrets,
        enabled = excluded.enabled, sort_order = excluded.sort_order, updated_at = excluded.updated_at
    `).run(input.id, input.kind, JSON.stringify(payload), encrypted, input.enabled ? 1 : 0, input.sortOrder ?? previous?.sortOrder ?? 0, new Date().toISOString())
    return this.listHubSources().find((item) => item.id === input.id) as HubSource
  }

  /** 源的 API Key 明文，只在主进程发请求时取。 */
  getHubSourceApiKey(id: string): string | null {
    const row = this.db.prepare('SELECT secrets FROM ability_sources WHERE id = ?').get(id) as { secrets: Buffer | null } | undefined
    if (!row?.secrets) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error(`无法解密源密钥：${id}`)
    return safeStorage.decryptString(row.secrets)
  }

  removeHubSource(id: string) {
    this.db.prepare('DELETE FROM ability_sources WHERE id = ?').run(id)
  }
}
