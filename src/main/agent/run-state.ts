import type { AgentEvent, AgentRunStatus, RunStatus, TurnActivity, TurnStatus } from '../../shared/types'

/** 一次运行的终局。与 agent_runs.status 的非 running 取值一一对应。 */
export type RunTerminalKind = 'completed' | 'failed' | 'cancelled' | 'interrupted'

/**
 * 一个事件对四处状态存储的完整投影。
 *
 * 事实源是 agent_runs：它跨进程存活，启动时由 markInterruptedAgentRuns 收敛残留。
 * conversation_run_states、conversation_turns、turn.activity 三处都是它的派生投影，
 * 必须由这一个函数一次算出，调用点不得再各自判断——四处各写各的正是状态错乱的来源。
 */
export interface RunStateProjection {
  terminal: RunTerminalKind | null
  /** conversation_run_states.status；null 表示本事件不触发该表写入。 */
  runStatus: RunStatus | null
  /** agent_runs 终态；只有终态事件非 null。 */
  ledgerStatus: Exclude<AgentRunStatus, 'running'> | null
  turnStatus: TurnStatus
  activityStatus: TurnActivity['status']
  hasUnreadResult: boolean
}

const WORKING: RunStateProjection = {
  terminal: null,
  runStatus: null,
  ledgerStatus: null,
  turnStatus: 'working',
  activityStatus: 'working',
  hasUnreadResult: false
}

/**
 * 事件类型 → 投影。模块级常量表，projectRunState 只做查表不构造对象：
 * emit 是流式期间每秒数十次的热路径，函数内的对象字面量会白白制造 GC 压力。
 *
 * interrupted 映射到 runStatus 'cancelled' 是既有行为——RunStatus 枚举里没有 interrupted 这一项，
 * 会话列表把「被中断」与「已取消」显示成同一档。改动它要连带改 runStatusPresentation，不在本次范围。
 */
const PROJECTIONS: Partial<Record<AgentEvent['type'], RunStateProjection>> = {
  run_started: { ...WORKING, runStatus: 'running' },
  approval_required: { ...WORKING, runStatus: 'waiting_user' },
  question_required: { ...WORKING, runStatus: 'waiting_user' },
  completed: { terminal: 'completed', runStatus: 'completed', ledgerStatus: 'completed', turnStatus: 'completed', activityStatus: 'done', hasUnreadResult: true },
  failed: { terminal: 'failed', runStatus: 'failed', ledgerStatus: 'failed', turnStatus: 'failed', activityStatus: 'failed', hasUnreadResult: true },
  cancelled: { terminal: 'cancelled', runStatus: 'cancelled', ledgerStatus: 'cancelled', turnStatus: 'cancelled', activityStatus: 'cancelled', hasUnreadResult: true },
  interrupted: { terminal: 'interrupted', runStatus: 'cancelled', ledgerStatus: 'interrupted', turnStatus: 'interrupted', activityStatus: 'interrupted', hasUnreadResult: true }
}

export function projectRunState(eventType: AgentEvent['type']): RunStateProjection {
  return PROJECTIONS[eventType] ?? WORKING
}

export interface TurnWriteState {
  turnStatus: TurnStatus
  activityStatus: TurnActivity['status']
}

/**
 * 已经结算过的回合不被后续事件改写。
 *
 * 终态之后仍会来事件（cleanup 阶段的 run_phase、contextUpdated 等），
 * 不挡住的话「已完成」会被这些事件重新推回 working。
 */
export function resolveTurnWrite(projection: RunStateProjection, prior: TurnWriteState): TurnWriteState {
  if (projection.terminal) return { turnStatus: projection.turnStatus, activityStatus: projection.activityStatus }
  if (prior.turnStatus !== 'working') return prior
  return { turnStatus: projection.turnStatus, activityStatus: projection.activityStatus }
}
