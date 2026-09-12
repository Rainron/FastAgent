import type Database from 'better-sqlite3'
import type { ModelUsageAggregate, ModelUsageRecord, ModelUsageSummary } from '../shared/types'

export const MODEL_USAGE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS model_request_usage (
    namespace TEXT NOT NULL,
    request_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    model_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL,
    cache_write_tokens INTEGER NOT NULL,
    read_availability TEXT NOT NULL,
    write_availability TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY(namespace, request_id),
    FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS model_request_usage_conversation ON model_request_usage(namespace, conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS model_request_usage_turn ON model_request_usage(namespace, conversation_id, turn_id);
`

const RECORD_COLUMNS = `request_id AS requestId, conversation_id AS conversationId, turn_id AS turnId, run_id AS runId,
  model_id AS modelId, provider, model_name AS modelName, created_at AS createdAt, input_tokens AS inputTokens,
  output_tokens AS outputTokens, cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens,
  read_availability AS readAvailability, write_availability AS writeAvailability, status`

const AGGREGATE_COLUMNS = `COUNT(*) AS requestCount,
  COALESCE(SUM(read_availability = 'reported'), 0) AS reportedReadRequests,
  COALESCE(SUM(write_availability = 'reported'), 0) AS reportedWriteRequests,
  COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens), 0) AS inputTokens,
  COALESCE(SUM(output_tokens), 0) AS outputTokens,
  COALESCE(SUM(CASE WHEN read_availability = 'reported' THEN input_tokens + cache_read_tokens + cache_write_tokens ELSE 0 END), 0) AS readInputTokens,
  COALESCE(SUM(CASE WHEN read_availability = 'reported' THEN cache_read_tokens ELSE 0 END), 0) AS cacheReadTokens,
  COALESCE(SUM(CASE WHEN write_availability = 'reported' THEN cache_write_tokens ELSE 0 END), 0) AS cacheWriteTokens`

export class ModelUsageStore {
  constructor(private readonly db: Database.Database) {}

  record(namespace: string, record: ModelUsageRecord): boolean {
    const result = this.db.prepare(`INSERT INTO model_request_usage(
      namespace, request_id, conversation_id, turn_id, run_id, model_id, provider, model_name, created_at,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, read_availability, write_availability, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(namespace, request_id) DO NOTHING`).run(
      namespace, record.requestId, record.conversationId, record.turnId, record.runId, record.modelId, record.provider,
      record.modelName, record.createdAt, record.inputTokens, record.outputTokens, record.cacheReadTokens,
      record.cacheWriteTokens, record.readAvailability, record.writeAvailability, record.status
    )
    return result.changes > 0
  }

  get(namespace: string, conversationId: string, turnId?: string): ModelUsageSummary {
    const latest = this.db.prepare(`SELECT ${RECORD_COLUMNS} FROM model_request_usage
      WHERE namespace = ? AND conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(namespace, conversationId) as ModelUsageRecord | undefined
    const session = this.db.prepare(`SELECT ${AGGREGATE_COLUMNS} FROM model_request_usage WHERE namespace = ? AND conversation_id = ?`).get(namespace, conversationId) as ModelUsageAggregate
    const turn = this.db.prepare(`SELECT ${AGGREGATE_COLUMNS} FROM model_request_usage WHERE namespace = ? AND conversation_id = ? AND turn_id = ?`).get(namespace, conversationId, turnId ?? latest?.turnId ?? '') as ModelUsageAggregate
    return { latest: latest ?? null, turn, session }
  }

  deleteConversation(namespace: string, conversationId: string): void {
    this.db.prepare('DELETE FROM model_request_usage WHERE namespace = ? AND conversation_id = ?').run(namespace, conversationId)
  }
}
