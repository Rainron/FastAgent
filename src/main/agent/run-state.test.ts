import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../shared/types'
import { projectRunState, resolveTurnWrite, type RunStateProjection } from './run-state'
import { createExecutionState, reduceExecutionState } from './execution-state'

const ALL_EVENT_TYPES: AgentEvent['type'][] = [
  'run_started', 'run_phase', 'token', 'thinking', 'thinking_started', 'thinking_ended',
  'tool_started', 'tool_result', 'approval_required', 'question_required', 'permission_changed',
  'file_changed', 'contextUpdated', 'compactionCompleted', 'todo_changed', 'sandbox_blocked',
  'sandbox_degraded', 'subagent_started', 'subagent_update', 'subagent_result', 'subagent_failed',
  'subagent_cancelled', 'completed', 'failed', 'cancelled', 'interrupted'
]

const TERMINAL_TYPES: AgentEvent['type'][] = ['completed', 'failed', 'cancelled', 'interrupted']

describe('projectRunState', () => {
  it('终态事件四处状态一次算齐', () => {
    expect(projectRunState('completed')).toEqual<RunStateProjection>({
      terminal: 'completed', runStatus: 'completed', ledgerStatus: 'completed',
      turnStatus: 'completed', activityStatus: 'done', hasUnreadResult: true
    })
    expect(projectRunState('failed')).toEqual<RunStateProjection>({
      terminal: 'failed', runStatus: 'failed', ledgerStatus: 'failed',
      turnStatus: 'failed', activityStatus: 'failed', hasUnreadResult: true
    })
    expect(projectRunState('cancelled')).toEqual<RunStateProjection>({
      terminal: 'cancelled', runStatus: 'cancelled', ledgerStatus: 'cancelled',
      turnStatus: 'cancelled', activityStatus: 'cancelled', hasUnreadResult: true
    })
  })

  it('interrupted 在台账里独立成一档，但会话列表仍按 cancelled 展示', () => {
    const projection = projectRunState('interrupted')
    expect(projection.ledgerStatus).toBe('interrupted')
    expect(projection.turnStatus).toBe('interrupted')
    expect(projection.activityStatus).toBe('interrupted')
    // RunStatus 枚举没有 interrupted，这是既有行为，改动要连带改 runStatusPresentation
    expect(projection.runStatus).toBe('cancelled')
  })

  it('等待用户的事件只改会话列表状态，不结算台账', () => {
    for (const type of ['approval_required', 'question_required'] as const) {
      const projection = projectRunState(type)
      expect(projection.runStatus).toBe('waiting_user')
      expect(projection.ledgerStatus).toBeNull()
      expect(projection.terminal).toBeNull()
      expect(projection.turnStatus).toBe('working')
    }
  })

  it('run_started 置为运行中', () => {
    expect(projectRunState('run_started')).toMatchObject({ runStatus: 'running', ledgerStatus: null, turnStatus: 'working' })
  })

  it('其余事件既不写会话列表也不结算台账', () => {
    const passive = ALL_EVENT_TYPES.filter((type) => ![...TERMINAL_TYPES, 'run_started', 'approval_required', 'question_required'].includes(type))
    for (const type of passive) {
      const projection = projectRunState(type)
      expect(projection, type).toMatchObject({ runStatus: null, ledgerStatus: null, terminal: null, turnStatus: 'working', activityStatus: 'working', hasUnreadResult: false })
    }
  })

  it('只有终态事件带未读标记与台账终态', () => {
    for (const type of ALL_EVENT_TYPES) {
      const projection = projectRunState(type)
      const isTerminal = TERMINAL_TYPES.includes(type)
      expect(Boolean(projection.terminal), type).toBe(isTerminal)
      expect(Boolean(projection.ledgerStatus), type).toBe(isTerminal)
      expect(projection.hasUnreadResult, type).toBe(isTerminal)
    }
  })

  it('返回模块级常量，热路径上不产生新对象', () => {
    expect(projectRunState('token')).toBe(projectRunState('file_changed'))
    expect(projectRunState('completed')).toBe(projectRunState('completed'))
  })
})

describe('resolveTurnWrite', () => {
  it('运行中的回合按投影写入', () => {
    const result = resolveTurnWrite(projectRunState('run_started'), { turnStatus: 'working', activityStatus: 'working' })
    expect(result).toEqual({ turnStatus: 'working', activityStatus: 'working' })
  })

  it('终态事件覆盖回合状态', () => {
    const result = resolveTurnWrite(projectRunState('completed'), { turnStatus: 'working', activityStatus: 'working' })
    expect(result).toEqual({ turnStatus: 'completed', activityStatus: 'done' })
  })

  it('已结算的回合不被后续非终态事件推回 working', () => {
    const prior = { turnStatus: 'completed' as const, activityStatus: 'done' as const }
    // cleanup 阶段的 run_phase / contextUpdated 都会在终态之后到达
    expect(resolveTurnWrite(projectRunState('run_phase'), prior)).toEqual(prior)
    expect(resolveTurnWrite(projectRunState('contextUpdated'), prior)).toEqual(prior)
  })

  it('终态之间仍可覆盖：取消先到、失败随后时以后者为准', () => {
    const prior = { turnStatus: 'cancelled' as const, activityStatus: 'cancelled' as const }
    expect(resolveTurnWrite(projectRunState('failed'), prior)).toEqual({ turnStatus: 'failed', activityStatus: 'failed' })
  })
})

describe('与 execution reducer 的终态一致性', () => {
  // 两套映射粒度不同（reducer 收的是 ExecutionEventType），不合并，靠断言锁住语义对应
  const expected: Record<string, string> = { completed: 'completed', failed: 'failed', cancelled: 'cancelled', interrupted: 'cancelled' }

  it('四个终态事件在两处映射到对应结局', () => {
    for (const type of TERMINAL_TYPES) {
      const terminalInput = type === 'completed' ? 'run_completed' : type === 'failed' ? 'run_failed' : 'run_cancelled'
      const state = reduceExecutionState(createExecutionState('run-1', []), { type: terminalInput, timestamp: 1 })
      expect(state.status, type).toBe(expected[type])
      expect(projectRunState(type).terminal, type).toBe(type)
    }
  })
})
