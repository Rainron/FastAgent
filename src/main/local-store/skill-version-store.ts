import type Database from 'better-sqlite3'
import type { SkillVersionRecord } from '../../shared/types'

/** 技能的启停状态与改写历史。 */
export class SkillVersionStore {
  constructor(private readonly db: Database.Database) {}

  isSkillEnabled(name: string) {
    const row = this.db.prepare('SELECT enabled FROM local_skill_state WHERE name = ?').get(name) as { enabled: number } | undefined
    return Boolean(row?.enabled)
  }

  setSkillEnabled(name: string, enabled: boolean) {
    this.db.prepare(`
      INSERT INTO local_skill_state(name, enabled, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `).run(name, enabled ? 1 : 0, new Date().toISOString())
  }

  removeSkillState(name: string) {
    this.db.prepare('DELETE FROM local_skill_state WHERE name = ?').run(name)
  }

  /** 改写 SKILL.md 之前存一份旧内容；修订号自增，回退时按它定位。 */
  recordSkillVersion(name: string, input: { content: string; description: string; version?: string | null; reason: SkillVersionRecord['reason'] }): number {
    const { next } = this.db.prepare('SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM skill_versions WHERE name = ?').get(name) as { next: number }
    this.db.prepare('INSERT INTO skill_versions(name, revision, content, description, version, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(name, next, input.content, input.description, input.version ?? null, input.reason, Date.now())
    return next
  }

  listSkillVersions(name: string): SkillVersionRecord[] {
    const rows = this.db.prepare('SELECT name, revision, description, version, reason, created_at FROM skill_versions WHERE name = ? ORDER BY revision DESC')
      .all(name) as Array<{ name: string; revision: number; description: string; version: string | null; reason: SkillVersionRecord['reason']; created_at: number }>
    return rows.map((row) => ({ name: row.name, revision: row.revision, description: row.description, version: row.version, reason: row.reason, createdAt: row.created_at }))
  }

  /** 当前修订号：运行中的任务按它绑定「用的是哪一版」。没有历史时为 0。 */
  latestSkillRevision(name: string): number {
    const { latest } = this.db.prepare('SELECT COALESCE(MAX(revision), 0) AS latest FROM skill_versions WHERE name = ?').get(name) as { latest: number }
    return latest
  }

  readSkillVersion(name: string, revision: number): string | null {
    const row = this.db.prepare('SELECT content FROM skill_versions WHERE name = ? AND revision = ?').get(name, revision) as { content: string } | undefined
    return row?.content ?? null
  }

  removeSkillVersions(name: string) {
    this.db.prepare('DELETE FROM skill_versions WHERE name = ?').run(name)
  }
}
