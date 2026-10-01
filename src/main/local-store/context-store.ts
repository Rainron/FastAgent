import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AppSettings, CompactionHistory, ContextPolicy, ContextState, ContextStrategy, ContextSummary } from '../../shared/types'
import { mapSummaryRow, type SummaryRow } from './row-mappers'

/** 会话级上下文：策略、模型运行时、当前用量、摘要与压缩历史。 */
export class ContextStore {
  constructor(private readonly db: Database.Database, private readonly settings: () => AppSettings) {}

  getContextPolicy(namespace: string, conversationId: string): ContextPolicy | null {
    const row = this.db.prepare('SELECT * FROM conversation_context_policy WHERE namespace = ? AND conversation_id = ?').get(namespace, conversationId) as {
      conversation_id: string; strategy: ContextStrategy; auto_summary: number; trigger_ratio: number | null; target_ratio: number | null; keep_recent_turns: number | null; inherit_global: number
    } | undefined
    return row ? {
      conversationId: row.conversation_id,
      strategy: row.strategy,
      autoSummary: Boolean(row.auto_summary),
      triggerRatio: row.trigger_ratio,
      targetRatio: row.target_ratio ?? null,
      keepRecentTurns: row.keep_recent_turns,
      inheritGlobal: Boolean(row.inherit_global)
    } : null
  }

  updateContextPolicy(namespace: string, conversationId: string, patch: Partial<Omit<ContextPolicy, 'conversationId'>>): ContextPolicy {
    const current = this.getContextPolicy(namespace, conversationId)
    const next: ContextPolicy = {
      conversationId,
      strategy: patch.strategy ?? current?.strategy ?? this.settings().contextStrategy,
      autoSummary: patch.autoSummary ?? current?.autoSummary ?? this.settings().autoSummary,
      triggerRatio: patch.triggerRatio === undefined ? (current?.triggerRatio ?? this.settings().triggerRatio) : patch.triggerRatio,
      targetRatio: patch.targetRatio === undefined ? (current?.targetRatio ?? this.settings().targetRatio) : patch.targetRatio,
      keepRecentTurns: patch.keepRecentTurns === undefined ? (current?.keepRecentTurns ?? this.settings().keepRecentTurns) : patch.keepRecentTurns,
      inheritGlobal: patch.inheritGlobal ?? current?.inheritGlobal ?? true
    }
    this.db.prepare(`
      INSERT INTO conversation_context_policy(namespace, conversation_id, strategy, auto_summary, trigger_ratio, target_ratio, keep_recent_turns, inherit_global)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, conversation_id) DO UPDATE SET strategy=excluded.strategy, auto_summary=excluded.auto_summary,
        trigger_ratio=excluded.trigger_ratio, target_ratio=excluded.target_ratio, keep_recent_turns=excluded.keep_recent_turns, inherit_global=excluded.inherit_global
    `).run(namespace, conversationId, next.strategy, next.autoSummary ? 1 : 0, next.triggerRatio, next.targetRatio, next.keepRecentTurns, next.inheritGlobal ? 1 : 0)
    return next
  }

  getConversationContextPolicy(namespace: string, conversationId: string) {
    return this.getContextPolicy(namespace, conversationId)
  }

  updateConversationContextPolicy(namespace: string, conversationId: string, patch: Partial<Omit<ContextPolicy, 'conversationId'>>) {
    return this.updateContextPolicy(namespace, conversationId, patch)
  }

  getModelRuntime(namespace: string, conversationId: string, provider: string, modelId: number) {
    return this.db.prepare('SELECT * FROM conversation_model_runtime WHERE namespace = ? AND conversation_id = ? AND provider = ? AND model_id = ?').get(namespace, conversationId, provider, modelId) as {
      session_file: string | null; context_window: number; estimated_tokens: number; message_tokens: number; tool_tokens: number; system_tokens: number; summary_tokens: number; attachment_tokens: number; counting_method: 'provider-usage' | 'fallback-estimate'; compaction_count: number; updated_at: string
    } | undefined ?? null
  }

  upsertModelRuntime(namespace: string, input: { conversationId: string; provider: string; modelId: number; sessionFile?: string | null; context: ContextState }) {
    const now = input.context.updatedAt || new Date().toISOString()
    this.db.prepare(`
      INSERT INTO conversation_model_runtime(namespace, conversation_id, provider, model_id, session_file, context_window, estimated_tokens, message_tokens, tool_tokens, system_tokens, summary_tokens, attachment_tokens, counting_method, compaction_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, conversation_id, provider, model_id) DO UPDATE SET session_file=COALESCE(excluded.session_file, conversation_model_runtime.session_file), context_window=excluded.context_window, estimated_tokens=excluded.estimated_tokens, message_tokens=excluded.message_tokens, tool_tokens=excluded.tool_tokens, system_tokens=excluded.system_tokens, summary_tokens=excluded.summary_tokens, attachment_tokens=excluded.attachment_tokens, counting_method=excluded.counting_method, compaction_count=excluded.compaction_count, updated_at=excluded.updated_at
    `).run(namespace, input.conversationId, input.provider, input.modelId, input.sessionFile ?? null, input.context.contextWindow, input.context.estimatedTokens, input.context.messageTokens, input.context.toolTokens, input.context.systemTokens, input.context.summaryTokens ?? 0, input.context.attachmentTokens ?? 0, input.context.countingMethod ?? 'fallback-estimate', input.context.compactionCount, now)
  }

  /**
   * 该会话是否已在这个 provider 下跑过。session 现在按会话共用，
   * 同 provider 换模型可以直接接着跑；跨 provider 的消息格式（尤其 thinking 签名块）
   * 不保证能被新 provider 接受，只有这种情况才需要先摘要再重开 session。
   */
  hasProviderRuntime(namespace: string, conversationId: string, provider: string) {
    const row = this.db.prepare('SELECT 1 FROM conversation_model_runtime WHERE namespace = ? AND conversation_id = ? AND provider = ? LIMIT 1').get(namespace, conversationId, provider)
    return Boolean(row)
  }

  getModelRuntimeSessionFile(namespace: string, conversationId: string, provider: string, modelId: number) {
    return this.getModelRuntime(namespace, conversationId, provider, modelId)?.session_file ?? null
  }

  setModelRuntimeSessionFile(namespace: string, conversationId: string, provider: string, modelId: number, sessionFile: string) {
    this.db.prepare('UPDATE conversation_model_runtime SET session_file = ?, updated_at = ? WHERE namespace = ? AND conversation_id = ? AND provider = ? AND model_id = ?').run(sessionFile, new Date().toISOString(), namespace, conversationId, provider, modelId)
  }

  getContextState(namespace: string, conversationId: string): ContextState | null {
    const row = this.db.prepare('SELECT * FROM conversation_context_state WHERE namespace = ? AND conversation_id = ?').get(namespace, conversationId) as {
      conversation_id: string; context_window: number; estimated_tokens: number; message_tokens: number; tool_tokens: number; system_tokens: number; compaction_count: number; latest_summary_id: string | null; updated_at: string
    } | undefined
    return row ? {
      conversationId: row.conversation_id,
      contextWindow: row.context_window,
      estimatedTokens: row.estimated_tokens,
      messageTokens: row.message_tokens,
      toolTokens: row.tool_tokens,
      systemTokens: row.system_tokens,
      compactionCount: row.compaction_count,
      latestSummaryId: row.latest_summary_id,
      updatedAt: row.updated_at
    } : null
  }

  upsertContextState(namespace: string, state: ContextState): ContextState {
    const updatedAt = state.updatedAt || new Date().toISOString()
    this.db.prepare(`
      INSERT INTO conversation_context_state(namespace, conversation_id, context_window, estimated_tokens, message_tokens, tool_tokens, system_tokens, compaction_count, latest_summary_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, conversation_id) DO UPDATE SET context_window=excluded.context_window, estimated_tokens=excluded.estimated_tokens,
        message_tokens=excluded.message_tokens, tool_tokens=excluded.tool_tokens, system_tokens=excluded.system_tokens,
        compaction_count=excluded.compaction_count, latest_summary_id=excluded.latest_summary_id, updated_at=excluded.updated_at
    `).run(namespace, state.conversationId, state.contextWindow, state.estimatedTokens, state.messageTokens, state.toolTokens, state.systemTokens, state.compactionCount, state.latestSummaryId, updatedAt)
    return { ...state, updatedAt }
  }

  saveContextState(namespace: string, state: ContextState) {
    return this.upsertContextState(namespace, state)
  }

  createContextSummary(namespace: string, input: Omit<ContextSummary, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): ContextSummary {
    const summary: ContextSummary = { ...input, id: input.id ?? `summary-${randomUUID()}`, createdAt: input.createdAt ?? new Date().toISOString() }
    this.db.prepare(`
      INSERT INTO conversation_summaries(namespace, id, conversation_id, version, summary_text, covered_turn_start, covered_turn_end, input_tokens, output_tokens, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(namespace, summary.id, summary.conversationId, summary.version, summary.summaryText, summary.coveredTurnStart, summary.coveredTurnEnd, summary.inputTokens, summary.outputTokens, summary.source, summary.createdAt)
    return summary
  }

  createSummary(namespace: string, input: Omit<ContextSummary, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) {
    return this.createContextSummary(namespace, input)
  }

  getContextSummary(namespace: string, id: string): ContextSummary | null {
    const row = this.db.prepare('SELECT * FROM conversation_summaries WHERE namespace = ? AND id = ?').get(namespace, id) as SummaryRow | undefined
    return row ? mapSummaryRow(row) : null
  }

  listContextSummaries(namespace: string, conversationId: string): ContextSummary[] {
    const rows = this.db.prepare('SELECT * FROM conversation_summaries WHERE namespace = ? AND conversation_id = ? ORDER BY version ASC, created_at ASC').all(namespace, conversationId) as SummaryRow[]
    return rows.map(mapSummaryRow)
  }

  /**
   * 最近一条按回合切出来的摘要。跨 provider 重开 session 时拿它当提示词种子，
   * 因此绝不能返回 Pi 会话内压出来的摘要——那份摘要之外还有保留区消息，新 session 拿不到。
   */
  latestTurnSummary(namespace: string, conversationId: string): ContextSummary | null {
    const row = this.db.prepare(`
      SELECT * FROM conversation_summaries
      WHERE namespace = ? AND conversation_id = ? AND source = 'turns'
      ORDER BY version DESC, created_at DESC LIMIT 1
    `).get(namespace, conversationId) as SummaryRow | undefined
    return row ? mapSummaryRow(row) : null
  }

  listSummaries(namespace: string, conversationId: string) {
    return this.listContextSummaries(namespace, conversationId)
  }

  recordCompaction(namespace: string, input: Omit<CompactionHistory, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): CompactionHistory {
    const record: CompactionHistory = { ...input, id: input.id ?? `compaction-${randomUUID()}`, createdAt: input.createdAt ?? new Date().toISOString() }
    this.db.prepare(`
      INSERT INTO conversation_compactions(namespace, id, conversation_id, strategy, trigger_reason, before_tokens, after_tokens, covered_turn_start, covered_turn_end, summary_id, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(namespace, record.id, record.conversationId, record.strategy, record.triggerReason, record.beforeTokens, record.afterTokens, record.coveredTurnStart, record.coveredTurnEnd, record.summaryId, record.durationMs, record.createdAt)
    return record
  }

  /** 只要条数时走 COUNT，不必把整段压缩历史读出来再取 length。 */
  countCompactions(namespace: string, conversationId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM conversation_compactions WHERE namespace = ? AND conversation_id = ?').get(namespace, conversationId) as { count: number }
    return row.count
  }

  listCompactionHistory(namespace: string, conversationId: string): CompactionHistory[] {
    // 摘要正文随列表一起带出：压缩历史面板每条都要能展开，逐条再查等于 N+1。
    const rows = this.db.prepare(`
      SELECT c.*, s.summary_text AS summary_text
      FROM conversation_compactions c
      LEFT JOIN conversation_summaries s ON s.namespace = c.namespace AND s.id = c.summary_id
      WHERE c.namespace = ? AND c.conversation_id = ?
      ORDER BY c.created_at DESC, c.id DESC
    `).all(namespace, conversationId) as Array<{ id: string; conversation_id: string; strategy: ContextStrategy; trigger_reason: string; before_tokens: number; after_tokens: number; covered_turn_start: string | null; covered_turn_end: string | null; summary_id: string | null; summary_text: string | null; duration_ms: number; created_at: string }>
    return rows.map((row) => ({ id: row.id, conversationId: row.conversation_id, strategy: row.strategy, triggerReason: row.trigger_reason, beforeTokens: row.before_tokens, afterTokens: row.after_tokens, coveredTurnStart: row.covered_turn_start, coveredTurnEnd: row.covered_turn_end, summaryId: row.summary_id, summaryText: row.summary_text, durationMs: row.duration_ms, createdAt: row.created_at }))
  }

  getCompactionHistory(namespace: string, conversationId: string) {
    return this.listCompactionHistory(namespace, conversationId)
  }

  /** session 目录迁移用：按模型分桶时代留下的路径也要一起搬。 */
  listModelRuntimeSessionFiles(namespace: string): Array<{ conversationId: string; sessionFile: string }> {
    const rows = this.db.prepare("SELECT conversation_id, session_file FROM conversation_model_runtime WHERE namespace = ? AND session_file IS NOT NULL AND session_file <> ''").all(namespace) as Array<{ conversation_id: string; session_file: string }>
    return rows.map((row) => ({ conversationId: row.conversation_id, sessionFile: row.session_file }))
  }

  /** 旧的按模型分桶列里还留着老目录下的路径，迁移时按目录前缀一起改写。 */
  remapModelRuntimeSessionFiles(namespace: string, conversationId: string, fromDir: string, toDir: string) {
    this.db.prepare(`
      UPDATE conversation_model_runtime SET session_file = ? || substr(session_file, ?), updated_at = ?
      WHERE namespace = ? AND conversation_id = ? AND session_file IS NOT NULL AND substr(session_file, 1, ?) = ?
    `).run(toDir, fromDir.length + 1, new Date().toISOString(), namespace, conversationId, fromDir.length, fromDir)
  }
}
