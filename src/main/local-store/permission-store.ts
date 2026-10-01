import type Database from 'better-sqlite3'
import type { StoredPermissionRule } from '../../shared/types'
import type { PermissionAction } from '../../shared/permission-rules'
import { sanitizeOverrides, type BuiltinPermissionPreset, type StoredPermissionProfile } from '../../shared/permission-profiles'
import { parseJson } from './row-mappers'

/** 权限规则与权限档位的落库行。 */
export class PermissionStore {
  constructor(private readonly db: Database.Database) {}

  listPermissionRules(namespace: string): StoredPermissionRule[] {
    const rows = this.db.prepare('SELECT tool_key, pattern, action, updated_at FROM permission_rules WHERE namespace = ? ORDER BY position ASC, updated_at ASC').all(namespace) as Array<{ tool_key: string; pattern: string; action: PermissionAction; updated_at: string }>
    return rows.map((row) => ({ toolKey: row.tool_key, pattern: row.pattern, action: row.action, updatedAt: row.updated_at }))
  }

  upsertPermissionRule(namespace: string, input: { toolKey: string; pattern: string; action: PermissionAction }) {
    const position = (this.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM permission_rules WHERE namespace = ?').get(namespace) as { next: number }).next
    this.db.prepare(`
      INSERT INTO permission_rules(namespace, tool_key, pattern, action, position, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, tool_key, pattern) DO UPDATE SET action = excluded.action, position = excluded.position, updated_at = excluded.updated_at
    `).run(namespace, input.toolKey, input.pattern, input.action, position, new Date().toISOString())
  }

  removePermissionRule(namespace: string, toolKey: string, pattern: string) {
    this.db.prepare('DELETE FROM permission_rules WHERE namespace = ? AND tool_key = ? AND pattern = ?').run(namespace, toolKey, pattern)
  }

  /** 只返回落库行；内置三档的补齐与排序由 shared/permission-profiles 的 mergeProfiles 负责。 */
  listPermissionProfiles(namespace: string): StoredPermissionProfile[] {
    const rows = this.db.prepare('SELECT profile_id, label, hint, base, builtin, overrides, position FROM permission_profiles WHERE namespace = ? ORDER BY position ASC, profile_id ASC').all(namespace) as Array<{ profile_id: string; label: string; hint: string; base: BuiltinPermissionPreset; builtin: number; overrides: string; position: number }>
    return rows.map((row) => ({
      id: row.profile_id,
      label: row.label,
      hint: row.hint,
      base: row.base,
      builtin: row.builtin === 1,
      overrides: sanitizeOverrides(parseJson<unknown>(row.overrides, {})),
      position: row.position
    }))
  }

  savePermissionProfile(namespace: string, profile: StoredPermissionProfile) {
    this.db.prepare(`
      INSERT INTO permission_profiles(namespace, profile_id, label, hint, base, builtin, overrides, position, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, profile_id) DO UPDATE SET
        label = excluded.label, hint = excluded.hint, base = excluded.base,
        overrides = excluded.overrides, position = excluded.position, updated_at = excluded.updated_at
    `).run(namespace, profile.id, profile.label, profile.hint, profile.base, profile.builtin ? 1 : 0, JSON.stringify(profile.overrides), profile.position, new Date().toISOString())
  }

  /** 内置档删除等于恢复出厂：删掉覆盖行后 mergeProfiles 会自动补回内置定义。 */
  removePermissionProfile(namespace: string, profileId: string) {
    this.db.prepare('DELETE FROM permission_profiles WHERE namespace = ? AND profile_id = ?').run(namespace, profileId)
  }
}
