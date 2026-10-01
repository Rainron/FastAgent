import type Database from 'better-sqlite3'
import type { AgentRunLedgerEntry, AgentRunRecord, AgentRunStatus, AgentTaskRecord, AgentTaskStatus, ConversationMode, ResumableRun, RunErrorKind, TurnActivity } from '../../shared/types'
import { mapAgentRun, mapAgentTask, parseJson, type AgentRunRow, type AgentTaskRow } from './row-mappers'

/** Agent 运行与子任务台账，以及重启后的中断收敛。 */
export class AgentRunStore {
  constructor(private readonly db: Database.Database) {}

  /**
   * Agent 运行台账。turn.activity 里已经有事件流，但那份是整段 JSON，跨会话统计要全表反序列化；
   * 这两张表存的是可直接查询的结构化状态，并且是重启后收敛「卡在 running」的唯一依据。
   */
  startAgentRun(namespace: string, input: { runId: string; conversationId: string; turnId: string; mode: ConversationMode; startedAt?: number }) {
    this.db.prepare(`
      INSERT INTO agent_runs(namespace, run_id, conversation_id, turn_id, mode, status, started_at, finished_at, error, error_kind, retry_count)
      VALUES (?, ?, ?, ?, ?, 'running', ?, NULL, NULL, NULL, 0)
      ON CONFLICT(namespace, run_id) DO UPDATE SET
        status = 'running', started_at = excluded.started_at, finished_at = NULL, error = NULL, error_kind = NULL, retry_count = 0
    `).run(namespace, input.runId, input.conversationId, input.turnId, input.mode, input.startedAt ?? Date.now())
  }

  /** 终态只认第一次：run_phase cleanup 之后还会有 contextUpdated 等事件，重复收尾不能覆盖真实结局。 */
  finishAgentRun(namespace: string, runId: string, status: Exclude<AgentRunStatus, 'running'>, error?: string | null, finishedAt?: number, errorKind?: RunErrorKind | null) {
    this.db.prepare(`
      UPDATE agent_runs SET status = ?, finished_at = ?, error = ?, error_kind = ?
      WHERE namespace = ? AND run_id = ? AND status = 'running'
    `).run(status, finishedAt ?? Date.now(), error ?? null, errorKind ?? null, namespace, runId)
  }

  /** 自动重试计数。运行中才累加：终态之后再来的重试事件不该改写已结算的记录。 */
  bumpAgentRunRetry(namespace: string, runId: string): number {
    this.db.prepare(`
      UPDATE agent_runs SET retry_count = retry_count + 1
      WHERE namespace = ? AND run_id = ? AND status = 'running'
    `).run(namespace, runId)
    const row = this.db.prepare('SELECT retry_count FROM agent_runs WHERE namespace = ? AND run_id = ?').get(namespace, runId) as { retry_count: number } | undefined
    return row?.retry_count ?? 0
  }

  startAgentTask(namespace: string, input: {
    taskId: string
    runId: string
    conversationId: string
    turnId: string
    parentToolCallId?: string | null
    subAgentRunId?: string | null
    agentId: string
    agentName: string
    goal: string
    startedAt?: number
  }) {
    this.db.prepare(`
      INSERT INTO agent_tasks(namespace, task_id, run_id, conversation_id, turn_id, parent_tool_call_id, sub_agent_run_id,
        agent_id, agent_name, goal, status, summary, error, started_at, finished_at, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, NULL, ?, NULL, NULL)
      ON CONFLICT(namespace, task_id) DO UPDATE SET
        status = 'running', started_at = excluded.started_at, finished_at = NULL, duration_ms = NULL, error = NULL
    `).run(
      namespace, input.taskId, input.runId, input.conversationId, input.turnId,
      input.parentToolCallId ?? null, input.subAgentRunId ?? null,
      input.agentId, input.agentName, input.goal, input.startedAt ?? Date.now()
    )
  }

  finishAgentTask(namespace: string, taskId: string, patch: {
    status: Exclude<AgentTaskStatus, 'queued' | 'running'>
    summary?: string | null
    error?: string | null
    finishedAt?: number
  }) {
    const finishedAt = patch.finishedAt ?? Date.now()
    this.db.prepare(`
      UPDATE agent_tasks SET
        status = ?, summary = ?, error = ?, finished_at = ?, duration_ms = ? - started_at
      WHERE namespace = ? AND task_id = ? AND status IN ('queued', 'running')
    `).run(patch.status, patch.summary ?? null, patch.error ?? null, finishedAt, finishedAt, namespace, taskId)
  }

  listAgentTasks(namespace: string, query: { runId?: string; conversationId?: string; turnId?: string; limit?: number } = {}): AgentTaskRecord[] {
    const conditions = ['namespace = ?']
    const params: unknown[] = [namespace]
    for (const [column, value] of [['run_id', query.runId], ['conversation_id', query.conversationId], ['turn_id', query.turnId]] as const) {
      if (!value) continue
      conditions.push(`${column} = ?`)
      params.push(value)
    }
    const rows = this.db.prepare(`
      SELECT task_id, run_id, conversation_id, turn_id, parent_tool_call_id, sub_agent_run_id, agent_id, agent_name,
             goal, status, summary, error, started_at, finished_at, duration_ms
      FROM agent_tasks WHERE ${conditions.join(' AND ')}
      ORDER BY started_at ASC, task_id ASC LIMIT ?
    `).all(...params, Math.min(Math.max(query.limit ?? 200, 1), 500)) as AgentTaskRow[]
    return rows.map(mapAgentTask)
  }

  /** 会话详情用：一次取运行与任务两张表，按 runId 归并，避免逐个运行再查一次任务。 */
  listAgentRunLedger(namespace: string, conversationId: string, limit = 20): AgentRunLedgerEntry[] {
    const runs = this.db.prepare(`
      SELECT run_id, conversation_id, turn_id, mode, status, started_at, finished_at, error, error_kind, retry_count
      FROM agent_runs WHERE namespace = ? AND conversation_id = ?
      ORDER BY started_at DESC, run_id DESC LIMIT ?
    `).all(namespace, conversationId, Math.min(Math.max(limit, 1), 100)) as AgentRunRow[]
    if (!runs.length) return []
    const placeholders = runs.map(() => '?').join(', ')
    const tasks = this.db.prepare(`
      SELECT task_id, run_id, conversation_id, turn_id, parent_tool_call_id, sub_agent_run_id, agent_id, agent_name,
             goal, status, summary, error, started_at, finished_at, duration_ms
      FROM agent_tasks WHERE namespace = ? AND run_id IN (${placeholders})
      ORDER BY started_at ASC, task_id ASC
    `).all(namespace, ...runs.map((run) => run.run_id)) as AgentTaskRow[]
    const byRun = new Map<string, AgentTaskRecord[]>()
    for (const row of tasks) {
      const list = byRun.get(row.run_id) ?? []
      list.push(mapAgentTask(row))
      byRun.set(row.run_id, list)
    }
    return runs.map((row) => ({ run: mapAgentRun(row), tasks: byRun.get(row.run_id) ?? [] }))
  }

  /**
   * 进程异常退出后，上一轮的 run/task 会永远停在 running。启动时收敛成 interrupted / cancelled，
   * 否则界面上的「执行中」永远转下去。activeRunIds 是当前进程真正在跑的运行，必须排除。
   *
   * 回合必须一起收敛：界面判定 spinner 与 streaming 看的是 conversation_turns.status 与
   * activity.status（MessageList、AssistantMessage），只改台账的话转圈永远不停。
   * 受影响的回合由这批 run 的 turn_id 圈定，是有界集合，不是全表扫描。
   */
  markInterruptedAgentRuns(namespace: string, activeRunIds: readonly string[] = []): number {
    const exclusion = activeRunIds.length ? ` AND run_id NOT IN (${activeRunIds.map(() => '?').join(', ')})` : ''
    const now = Date.now()
    const reconcile = this.db.transaction(() => {
      // 先取 turn_id：update 之后这些行就不再是 running，圈不出来了
      const orphanTurnIds = (this.db.prepare(`SELECT DISTINCT turn_id FROM agent_runs WHERE namespace = ? AND status = 'running'${exclusion}`)
        .all(namespace, ...activeRunIds) as Array<{ turn_id: string }>).map((row) => row.turn_id)
      const runs = this.db.prepare(`UPDATE agent_runs SET status = 'interrupted', finished_at = ?, error = COALESCE(error, '任务已中断') WHERE namespace = ? AND status = 'running'${exclusion}`)
        .run(now, namespace, ...activeRunIds)
      this.db.prepare(`UPDATE agent_tasks SET status = 'cancelled', finished_at = ?, duration_ms = ? - started_at WHERE namespace = ? AND status IN ('queued', 'running')${exclusion}`)
        .run(now, now, namespace, ...activeRunIds)
      this.settleOrphanTurns(namespace, orphanTurnIds, now)
      return runs.changes
    })
    return reconcile()
  }

  getAgentRun(namespace: string, runId: string): AgentRunRecord | null {
    const row = this.db.prepare(`
      SELECT run_id, conversation_id, turn_id, mode, status, started_at, finished_at, error, error_kind, retry_count
      FROM agent_runs WHERE namespace = ? AND run_id = ?
    `).get(namespace, runId) as AgentRunRow | undefined
    return row ? mapAgentRun(row) : null
  }

  /**
   * 会话最近一次可续跑的中断运行。只看最后一条运行：中间某次中断之后用户又发过新消息的，
   * 上下文早已往前走，再回头续跑只会制造重复劳动。
   *
   * 只取计数，不读 activity：会话打开时就要问一次，走 listTurns 会把整段历史反序列化。
   */
  findResumableRun(namespace: string, conversationId: string): ResumableRun | null {
    const run = this.db.prepare(`
      SELECT run_id, turn_id, status, error, error_kind, finished_at
      FROM agent_runs WHERE namespace = ? AND conversation_id = ?
      ORDER BY started_at DESC, run_id DESC LIMIT 1
    `).get(namespace, conversationId) as { run_id: string; turn_id: string; status: AgentRunStatus; error: string | null; error_kind: RunErrorKind | null; finished_at: number | null } | undefined
    if (!run || run.status !== 'interrupted') return null

    const turn = this.db.prepare('SELECT user_message FROM conversation_turns WHERE namespace = ? AND turn_id = ?')
      .get(namespace, run.turn_id) as { user_message: string } | undefined
    if (!turn) return null

    const pendingTodos = (this.db.prepare(`
      SELECT COUNT(*) AS total FROM session_todos
      WHERE namespace = ? AND conversation_id = ? AND status NOT IN ('completed', 'cancelled', 'skipped')
    `).get(namespace, conversationId) as { total: number }).total
    const changedFiles = (this.db.prepare('SELECT COUNT(*) AS total FROM agent_file_changes WHERE namespace = ? AND turn_id = ?')
      .get(namespace, run.turn_id) as { total: number }).total

    return {
      runId: run.run_id,
      conversationId,
      turnId: run.turn_id,
      goal: parseJson<{ text?: string }>(turn.user_message, {}).text ?? '',
      reason: run.error,
      errorKind: run.error_kind ?? null,
      pendingTodos,
      changedFiles,
      interruptedAt: run.finished_at ?? 0
    }
  }

  /** 把中断运行留下的 working 回合结算掉；已有终态的回合不动。 */
  private settleOrphanTurns(namespace: string, turnIds: readonly string[], now: number) {
    if (!turnIds.length) return
    const finishedAt = new Date(now).toISOString()
    const select = this.db.prepare("SELECT activity FROM conversation_turns WHERE namespace = ? AND turn_id = ? AND status = 'working'")
    const update = this.db.prepare("UPDATE conversation_turns SET status = 'interrupted', activity = ?, updated_at = ? WHERE namespace = ? AND turn_id = ? AND status = 'working'")
    for (const turnId of turnIds) {
      const row = select.get(namespace, turnId) as { activity: string | null } | undefined
      if (!row) continue
      const activity = parseJson<TurnActivity | null>(row.activity, null)
      // activity 缺失或损坏时只改 status：execution 快照在读取侧由 normalizeTurnActivity 按 turn.status 归一
      const nextActivity = activity ? JSON.stringify({ ...activity, status: 'interrupted', finishedAt: activity.finishedAt ?? finishedAt }) : row.activity
      update.run(nextActivity, finishedAt, namespace, turnId)
    }
  }
}
