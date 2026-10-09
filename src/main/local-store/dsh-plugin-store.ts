import type Database from 'better-sqlite3'
import type { DshPluginActivation, DshPluginRecord } from '../../shared/types'
import { parseJson } from './row-mappers'

/** 一行落库所需的字段；activation 是挂载结果，随宿主重启刷新。 */
export interface DshPluginInput {
  name: string
  version: string
  displayName: string
  description: string
  author?: string
  homepage?: string
  installPath: string
  mainEntry: string
  enabled: boolean
  inject: string[]
  config: Record<string, unknown>
}

interface Row {
  name: string
  version: string
  payload: string
  enabled: number
  config: string
  activation: string | null
  installed_at: string
}

/** 已安装的 dsh 插件。不并进 ability 体系：两者的生命周期与来源都不一样。 */
export class DshPluginStore {
  constructor(private readonly db: Database.Database) {}

  listDshPlugins(): DshPluginRecord[] {
    const rows = this.db.prepare('SELECT name, version, payload, enabled, config, activation, installed_at FROM dsh_plugins ORDER BY installed_at ASC, name ASC').all() as Row[]
    return rows.map(toRecord)
  }

  getDshPlugin(name: string): DshPluginRecord | null {
    const row = this.db.prepare('SELECT name, version, payload, enabled, config, activation, installed_at FROM dsh_plugins WHERE name = ?').get(name) as Row | undefined
    return row ? toRecord(row) : null
  }

  countDshPlugins(): number {
    const [row] = this.db.prepare('SELECT COUNT(*) AS total FROM dsh_plugins').all() as Array<{ total: number }>
    return row?.total ?? 0
  }

  saveDshPlugin(input: DshPluginInput): DshPluginRecord {
    const { name, version, enabled, config, ...payload } = input
    this.db.prepare(`
      INSERT INTO dsh_plugins(name, version, payload, enabled, config, activation, installed_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(name) DO UPDATE SET
        version = excluded.version, payload = excluded.payload, config = excluded.config
    `).run(name, version, JSON.stringify(payload), enabled ? 1 : 0, JSON.stringify(config), new Date().toISOString())
    return this.getDshPlugin(name) as DshPluginRecord
  }

  setDshPluginEnabled(name: string, enabled: boolean) {
    this.db.prepare('UPDATE dsh_plugins SET enabled = ? WHERE name = ?').run(enabled ? 1 : 0, name)
  }

  setDshPluginConfig(name: string, config: Record<string, unknown>) {
    this.db.prepare('UPDATE dsh_plugins SET config = ? WHERE name = ?').run(JSON.stringify(config), name)
  }

  /** 挂载结果由宿主给出，每次重启都会覆盖；null 表示还没挂过。 */
  setDshPluginActivation(name: string, activation: DshPluginActivation | null) {
    this.db.prepare('UPDATE dsh_plugins SET activation = ? WHERE name = ?').run(activation ? JSON.stringify(activation) : null, name)
  }

  removeDshPlugin(name: string) {
    this.db.prepare('DELETE FROM dsh_plugins WHERE name = ?').run(name)
  }
}

function toRecord(row: Row): DshPluginRecord {
  const payload = parseJson<Omit<DshPluginRecord, 'name' | 'version' | 'enabled' | 'config' | 'activation' | 'installedAt'>>(row.payload, {} as never)
  return {
    ...payload,
    name: row.name,
    version: row.version,
    enabled: row.enabled === 1,
    config: parseJson<Record<string, unknown>>(row.config, {}),
    activation: row.activation ? parseJson<DshPluginActivation | null>(row.activation, null) : null,
    installedAt: row.installed_at
  }
}
