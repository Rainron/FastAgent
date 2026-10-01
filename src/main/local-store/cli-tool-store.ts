import type Database from 'better-sqlite3'
import type { CliToolCheck, LocalCliTool } from '../../shared/types'
import { parseJson } from './row-mappers'

/** 本地 CLI 工具登记与可用性检查结果。 */
export class CliToolStore {
  constructor(private readonly db: Database.Database) {}

  listCliTools(): LocalCliTool[] {
    const rows = this.db.prepare('SELECT id, payload FROM local_cli_tools ORDER BY updated_at ASC, id ASC').all() as Array<{ id: string; payload: string }>
    return rows.map((row) => ({ ...parseJson<Omit<LocalCliTool, 'id'>>(row.payload, {} as never), id: row.id }))
  }

  saveCliTool(input: LocalCliTool): LocalCliTool {
    const { id: _id, ...payload } = input
    this.db.prepare(`
      INSERT INTO local_cli_tools(id, payload, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(input.id, JSON.stringify(payload), new Date().toISOString())
    return this.listCliTools().find((item) => item.id === input.id) as LocalCliTool
  }

  getCliToolCheck(id: string): CliToolCheck | null {
    const row = this.db.prepare('SELECT check_result FROM local_cli_tools WHERE id = ?').get(id) as { check_result: string | null } | undefined
    return row?.check_result ? parseJson<CliToolCheck | null>(row.check_result, null) : null
  }

  listCliToolChecks(): Array<{ id: string; check: CliToolCheck }> {
    const rows = this.db.prepare('SELECT id, check_result FROM local_cli_tools WHERE check_result IS NOT NULL').all() as Array<{ id: string; check_result: string }>
    return rows.flatMap((row) => {
      const check = parseJson<CliToolCheck | null>(row.check_result, null)
      return check ? [{ id: row.id, check }] : []
    })
  }

  setCliToolCheck(id: string, check: CliToolCheck) {
    this.db.prepare('UPDATE local_cli_tools SET check_result = ? WHERE id = ?').run(JSON.stringify(check), id)
    return check
  }

  removeCliTool(id: string) {
    this.db.prepare('DELETE FROM local_cli_tools WHERE id = ?').run(id)
  }

  /** CLI 工具行的 updated_at，用于 meta 回填的 installed_at。 */
  listCliToolTimestamps(): Array<{ id: string; updatedAt: string }> {
    const rows = this.db.prepare('SELECT id, updated_at FROM local_cli_tools').all() as Array<{ id: string; updated_at: string }>
    return rows.map((row) => ({ id: row.id, updatedAt: row.updated_at }))
  }
}
