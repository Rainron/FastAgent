import type Database from 'better-sqlite3'
import type { AbilityInstallMeta, AbilitySource, AbilityType } from '../../shared/types'
import { mapAbilityMeta, type AbilityMetaRow } from './row-mappers'

/** 能力的安装来源、版本与使用计数。 */
export class AbilityMetaStore {
  constructor(private readonly db: Database.Database) {}

  listAbilityMeta(): AbilityInstallMeta[] {
    const rows = this.db.prepare('SELECT * FROM ability_install_meta').all() as AbilityMetaRow[]
    return rows.map(mapAbilityMeta)
  }

  getAbilityMeta(abilityType: AbilityType, abilityId: string): AbilityInstallMeta | null {
    const row = this.db.prepare('SELECT * FROM ability_install_meta WHERE ability_type = ? AND ability_id = ?').get(abilityType, abilityId) as AbilityMetaRow | undefined
    return row ? mapAbilityMeta(row) : null
  }

  upsertAbilityMeta(input: { abilityType: AbilityType; abilityId: string; source: AbilitySource; pluginId?: string | null; sourceId?: string | null; version?: string | null; installedAt?: string }): AbilityInstallMeta {
    const now = new Date().toISOString()
    const existing = this.getAbilityMeta(input.abilityType, input.abilityId)
    const installedAt = input.installedAt ?? existing?.installedAt ?? now
    this.db.prepare(`
      INSERT INTO ability_install_meta(ability_type, ability_id, source, plugin_id, source_id, version, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ability_type, ability_id) DO UPDATE SET source = excluded.source, plugin_id = excluded.plugin_id,
        source_id = excluded.source_id, version = excluded.version, installed_at = excluded.installed_at, updated_at = excluded.updated_at
    `).run(input.abilityType, input.abilityId, input.source, input.pluginId ?? null, input.sourceId ?? null, input.version ?? null, installedAt, now)
    return this.getAbilityMeta(input.abilityType, input.abilityId) as AbilityInstallMeta
  }

  removeAbilityMeta(abilityType: AbilityType, abilityId: string) {
    this.db.prepare('DELETE FROM ability_install_meta WHERE ability_type = ? AND ability_id = ?').run(abilityType, abilityId)
  }

  /** 检查更新的结果落库，能力页与侧栏徽标据此判断有没有新版，不必再开 Hub。 */
  setAbilityLatestVersion(abilityType: AbilityType, abilityId: string, version: string | null, checkedAt = new Date().toISOString()) {
    this.db.prepare('UPDATE ability_install_meta SET latest_version = ?, latest_checked_at = ? WHERE ability_type = ? AND ability_id = ?')
      .run(version, checkedAt, abilityType, abilityId)
  }

  /** 记一次「本轮用到了这个能力」。调用方负责按轮去重，这里不做频次控制。 */
  touchAbilityUsage(abilityType: AbilityType, abilityId: string, usedAt = new Date().toISOString()) {
    this.db.prepare('UPDATE ability_install_meta SET last_used_at = ?, use_count = use_count + 1 WHERE ability_type = ? AND ability_id = ?')
      .run(usedAt, abilityType, abilityId)
  }

  /** 目录/表里有、meta 表没有的能力补一条来源记录；无法区分新建与导入时按 imported 处理，风险更高的一侧优先。 */
  backfillAbilityMeta(entries: Array<{ abilityType: AbilityType; abilityId: string; installedAt?: string }>) {
    const known = new Set(this.listAbilityMeta().map((meta) => `${meta.abilityType}::${meta.abilityId}`))
    const pending = entries.filter((entry) => !known.has(`${entry.abilityType}::${entry.abilityId}`))
    if (!pending.length) return 0
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO ability_install_meta(ability_type, ability_id, source, plugin_id, version, installed_at, updated_at)
      VALUES (?, ?, 'imported', NULL, NULL, ?, ?)
    `)
    const now = new Date().toISOString()
    this.db.transaction(() => {
      for (const entry of pending) insert.run(entry.abilityType, entry.abilityId, entry.installedAt ?? now, now)
    })()
    return pending.length
  }
}
