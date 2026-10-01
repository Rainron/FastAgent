import type Database from 'better-sqlite3'
import type { AppSettings, ClientPreferences } from '../../shared/types'
import { normalizeAttachmentPolicy } from '../../shared/attachment-policy'
import { normalizeSandboxSettings } from '../../shared/sandbox'
import { normalizePageSize } from '../../shared/pagination'
import { defaultClientPreferences, defaultSettings, normalizeMemorySettings, normalizeRunLimits, parseJson } from './row-mappers'

/** 应用设置与客户端偏好：两者都是 key/scope 单行 JSON，读写规则同源。 */
export class SettingsStore {
  constructor(private readonly db: Database.Database) {}

  getSettings(): AppSettings {
    const row = this.db.prepare('SELECT payload FROM app_settings WHERE key = ?').get('global') as { payload: string } | undefined
    const stored = parseJson<Partial<AppSettings>>(row?.payload, {})
    // sandbox 为嵌套对象，浅合并救不了缺字段的旧记录，单独归一化。
    return { ...defaultSettings, ...stored, ...normalizeAttachmentPolicy(stored), sandbox: normalizeSandboxSettings(stored.sandbox).settings, memory: normalizeMemorySettings(stored.memory), limits: normalizeRunLimits(stored.limits) }
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const merged = { ...this.getSettings(), ...patch }
    const next = { ...merged, ...normalizeAttachmentPolicy(merged) }
    this.db.prepare(`
      INSERT INTO app_settings(key, payload, updated_at) VALUES ('global', ?, ?)
      ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(JSON.stringify(next), new Date().toISOString())
    return next
  }

  getClientPreferences(namespace: string | null): ClientPreferences {
    const globalRow = this.db.prepare('SELECT payload FROM client_preferences WHERE scope = ?').get('global') as { payload: string } | undefined
    const accountRow = namespace ? this.db.prepare('SELECT payload FROM client_preferences WHERE scope = ?').get(namespace) as { payload: string } | undefined : undefined
    const globalPreferences = parseJson<Partial<ClientPreferences>>(globalRow?.payload, {})
    const merged = {
      ...defaultClientPreferences(),
      ...globalPreferences,
      ...parseJson<Partial<ClientPreferences>>(accountRow?.payload, {})
    }
    // 页长只认 global：account scope 排在后面，旧库里残留的这个字段会永远盖掉全局设置
    return { ...merged, paginationPageSize: normalizePageSize(globalPreferences.paginationPageSize) }
  }

  updateClientPreferences(namespace: string | null, patch: Partial<ClientPreferences>): ClientPreferences {
    const globalPatch: Partial<ClientPreferences> = {}
    const accountPatch: Partial<ClientPreferences> = {}
    if (patch.recentServers !== undefined) globalPatch.recentServers = patch.recentServers
    if (patch.modePrompts !== undefined) globalPatch.modePrompts = patch.modePrompts
    if (patch.favoriteModelIds !== undefined) accountPatch.favoriteModelIds = patch.favoriteModelIds
    if (patch.recentModelIds !== undefined) accountPatch.recentModelIds = patch.recentModelIds
    if (patch.selectedModelId !== undefined) accountPatch.selectedModelId = patch.selectedModelId
    if (patch.sidebarSections !== undefined) globalPatch.sidebarSections = patch.sidebarSections
    // 页长是跨账号的全局偏好；写进 account scope 会在读取时反向覆盖 global
    if (patch.paginationPageSize !== undefined) globalPatch.paginationPageSize = normalizePageSize(patch.paginationPageSize)
    const save = (scope: string, nextPatch: Partial<ClientPreferences>) => {
      if (!Object.keys(nextPatch).length) return
      const row = this.db.prepare('SELECT payload FROM client_preferences WHERE scope = ?').get(scope) as { payload: string } | undefined
      const next = { ...parseJson<Partial<ClientPreferences>>(row?.payload, {}), ...nextPatch }
      this.db.prepare(`
        INSERT INTO client_preferences(scope, payload, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(scope) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `).run(scope, JSON.stringify(next), new Date().toISOString())
    }
    save('global', globalPatch)
    if (namespace) save(namespace, accountPatch)
    return this.getClientPreferences(namespace)
  }
}
