import { safeStorage } from 'electron'
import type Database from 'better-sqlite3'
import type { LocalModelInput, LocalModelSummary, ModelCredentials } from '../../shared/types'
import { parseJson } from './row-mappers'

/** 用户自建模型：密钥走 safeStorage 密文，对外只透出 hasApiKey。 */
export class LocalModelStore {
  constructor(private readonly db: Database.Database) {}

  /**
   * 本地模型列表（对外只读形态）。id 对外取负，与云端正整数隔离；
   * secrets 只回传 hasApiKey，密钥本身绝不出主进程。
   */
  listLocalModels(): LocalModelSummary[] {
    const rows = this.db.prepare('SELECT id, payload, secrets, updated_at FROM local_models ORDER BY updated_at ASC, id ASC').all() as Array<{ id: number; payload: string; secrets: Buffer | null; updated_at: string }>
    return rows.map((row) => {
      const payload = parseJson<Omit<LocalModelInput, 'api_key' | 'headers'>>(row.payload, {} as Omit<LocalModelInput, 'api_key' | 'headers'>)
      const legacyProtocol = (['openai', 'anthropic', 'openai-responses'] as string[]).includes(payload.provider) ? payload.provider as 'openai' | 'anthropic' | 'openai-responses' : 'openai'
      const protocol = payload.protocol ?? legacyProtocol
      const provider = payload.protocol ? payload.provider : payload.name
      return {
        ...payload,
        provider,
        protocol,
        id: -row.id,
        hasApiKey: Boolean(row.secrets),
        updatedAt: row.updated_at
      } as LocalModelSummary
    })
  }

  /**
   * 新增（dbId 为 null）或更新本地模型。api_key / headers 加密存 secrets；
   * 更新时两者缺省表示保留旧值，显式传空字符串 / 空对象表示清空。
   */
  saveLocalModel(dbId: number | null, input: LocalModelInput): LocalModelSummary {
    const existing = dbId !== null
      ? this.db.prepare('SELECT secrets FROM local_models WHERE id = ?').get(dbId) as { secrets: Buffer | null } | undefined
      : undefined
    let encrypted = existing?.secrets ?? null
    // 只有本次显式提供了 api_key / headers 才需要解密旧密钥做字段级合并；
    // 两者都缺省时直接保留原密文，避免无谓解密。
    if (input.api_key !== undefined || input.headers !== undefined) {
      let current: { api_key?: string; headers?: Record<string, string> } = {}
      if (existing?.secrets) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法读取本地模型密钥')
        current = parseJson(safeStorage.decryptString(existing.secrets), {})
      }
      const secrets: { api_key?: string; headers?: Record<string, string> } = { ...current }
      if (input.api_key !== undefined) {
        if (input.api_key) secrets.api_key = input.api_key
        else delete secrets.api_key
      }
      if (input.headers !== undefined) {
        if (Object.keys(input.headers).length) secrets.headers = input.headers
        else delete secrets.headers
      }
      const hasSecrets = Object.keys(secrets).length > 0
      if (hasSecrets && !safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，不能保存 API Key')
      encrypted = hasSecrets ? safeStorage.encryptString(JSON.stringify(secrets)) : null
    }
    const { api_key: _apiKey, headers: _headers, ...payload } = input
    const now = new Date().toISOString()
    if (dbId === null) {
      const result = this.db.prepare('INSERT INTO local_models(payload, secrets, updated_at) VALUES (?, ?, ?)').run(JSON.stringify(payload), encrypted, now)
      dbId = Number(result.lastInsertRowid)
    } else {
      this.db.prepare('UPDATE local_models SET payload = ?, secrets = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(payload), encrypted, now, dbId)
    }
    return this.listLocalModels().find((item) => item.id === -dbId) as LocalModelSummary
  }

  /** 本地模型完整运行配置：解密合并 api_key / headers，供主进程组装 ModelCredentials。 */
  getLocalModelRuntimeConfig(dbId: number): Omit<ModelCredentials, 'id'> | null {
    const row = this.db.prepare('SELECT payload, secrets FROM local_models WHERE id = ?').get(dbId) as { payload: string; secrets: Buffer | null } | undefined
    if (!row) return null
    const payload = parseJson<Omit<LocalModelInput, 'api_key' | 'headers'>>(row.payload, {} as Omit<LocalModelInput, 'api_key' | 'headers'>)
    const legacyProtocol = (['openai', 'anthropic', 'openai-responses'] as string[]).includes(payload.provider) ? payload.provider as 'openai' | 'anthropic' | 'openai-responses' : 'openai'
    const protocol = payload.protocol ?? legacyProtocol
    const provider = payload.protocol ? payload.provider : payload.name
    let secrets: { api_key?: string; headers?: Record<string, string> } = {}
    if (row.secrets) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法读取本地模型密钥')
      secrets = parseJson(safeStorage.decryptString(row.secrets), {})
    }
    return { ...payload, provider, protocol, api_key: secrets.api_key ?? '', headers: secrets.headers }
  }

  removeLocalModel(dbId: number) {
    this.db.prepare('DELETE FROM local_models WHERE id = ?').run(dbId)
  }
}
