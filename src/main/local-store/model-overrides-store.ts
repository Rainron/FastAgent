import type Database from 'better-sqlite3'
import { isEmptyOverride, normalizeOverride, overrideKey, type ModelParameterOverride } from '../../shared/model-parameters'

export const MODEL_OVERRIDES_SQL = `CREATE TABLE IF NOT EXISTS model_overrides (
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(provider, model_name)
);`

type Row = { provider: string; model_name: string; payload: string }

/**
 * 云端模型的本地参数覆盖。不按 namespace 分：同一台机器上同一个模型的窗口大小
 * 不会因为换了账号就不一样，按账号存只会让用户在每个账号里各填一遍。
 */
export class ModelOverrideStore {
  constructor(private readonly db: Database.Database) {}

  listModelOverrides(): Map<string, ModelParameterOverride> {
    const rows = this.db.prepare('SELECT provider, model_name, payload FROM model_overrides').all() as Row[]
    const result = new Map<string, ModelParameterOverride>()
    for (const row of rows) {
      // 单行 JSON 损坏不该让整份覆盖读不出来。
      try { result.set(overrideKey(row.provider, row.model_name), normalizeOverride(JSON.parse(row.payload))) }
      catch { continue }
    }
    return result
  }

  getModelOverride(provider: string, modelName: string): ModelParameterOverride {
    const row = this.db.prepare('SELECT payload FROM model_overrides WHERE provider = ? AND model_name = ?').get(provider, modelName) as { payload: string } | undefined
    if (!row) return {}
    try { return normalizeOverride(JSON.parse(row.payload)) } catch { return {} }
  }

  /** 覆盖清空即删行：留一行空 JSON 会让「用户设过」与「用户清掉了」看起来一样。 */
  setModelOverride(provider: string, modelName: string, override: ModelParameterOverride): ModelParameterOverride {
    const normalized = normalizeOverride(override)
    if (isEmptyOverride(normalized)) {
      this.db.prepare('DELETE FROM model_overrides WHERE provider = ? AND model_name = ?').run(provider, modelName)
      return {}
    }
    this.db.prepare('INSERT INTO model_overrides(provider, model_name, payload, updated_at) VALUES(?,?,?,?) ON CONFLICT(provider, model_name) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at')
      .run(provider, modelName, JSON.stringify(normalized), new Date().toISOString())
    return normalized
  }
}
