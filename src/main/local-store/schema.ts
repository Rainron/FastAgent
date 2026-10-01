import type Database from 'better-sqlite3'
import { migrateSharedWorkspace } from './shared-workspace'
import { migrateLegacyLocalModels } from './model-connections'
import { ensureKbEntrySourceColumns } from '../kb-store'
import {
  backfillArtifactsFromTurnEvents, backfillConversationModelId, ensureAbilityMetaLatestColumns, ensureAbilityMetaSourceColumn,
  ensureAccountLayoutColumns, ensureAgentRunDiagnosticColumns, ensureContextPolicyForceCompaction,
  ensureConversationModelColumn, ensureConversationProjectColumn, ensureFileChangeBeforeText,
  ensureCompactionContextWindow, ensureSummarySourceColumn, ensureTodoPlanColumns, ensureTodoStatusExtended,
  ensureToolCallSourceColumn, ensureToolCallSubAgentColumns, ensureTurnSessionAnchorColumn, ensureTurnStatusInterrupted,
  migrateLegacyMessages, migrateModelSessionToConversation, stripEventExecutionSnapshots,
  SCHEMA_VERSION
} from './migrations'

export { SCHEMA_SQL } from './schema-sql'

/**
 * 建表之后按固定顺序补列、改约束、迁移旧数据；顺序与建库时的调用顺序一致。
 *
 * 补列/改约束这批只做一次 PRAGMA table_info（或一次 sqlite_master 查询）就能判定是否需要动，
 * 开销与库大小无关，因此不受 user_version 门控——新增列才不必抬版本号去连带重跑下面的全表扫描。
 * user_version 门控的是真正按会话数线性增长的那两个迁移。
 */
export function applyMigrations(db: Database.Database) {
  ensureAccountLayoutColumns(db)
  ensureConversationProjectColumn(db)
  ensureConversationModelColumn(db)
  ensureToolCallSubAgentColumns(db)
  ensureToolCallSourceColumn(db)
  ensureAbilityMetaSourceColumn(db)
  ensureAbilityMetaLatestColumns(db)
  ensureTurnStatusInterrupted(db)
  ensureTurnSessionAnchorColumn(db)
  // 补列必须在整表重建之前：重建时按列名搬数据，列不存在会直接报错。
  ensureTodoPlanColumns(db)
  ensureTodoStatusExtended(db)
  ensureAgentRunDiagnosticColumns(db)
  ensureKbEntrySourceColumns(db)
  ensureFileChangeBeforeText(db)
  ensureSummarySourceColumn(db)
  ensureContextPolicyForceCompaction(db)
  ensureCompactionContextWindow(db)

  const [{ user_version: current }] = db.pragma('user_version') as Array<{ user_version: number }>
  if (current >= SCHEMA_VERSION) return
  // 逐档判断：抬版本号是为了跑新增的那一个迁移，不该把旧档的全表扫描一起再来一遍。
  if (current < 2) {
    migrateLegacyMessages(db)
    migrateModelSessionToConversation(db)
    backfillArtifactsFromTurnEvents(db)
  }
  if (current < 3) stripEventExecutionSnapshots(db)
  if (current < 4) migrateSharedWorkspace(db)
  if (current < 5) migrateLegacyLocalModels(db)
  if (current < 6) backfillConversationModelId(db)
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
}
