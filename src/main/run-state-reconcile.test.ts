import { describe, expect, it } from 'vitest'
import type { ConversationRunState } from '../shared/types'
import { staleRunStates } from './run-state-reconcile'

function state(conversationId: string, status: ConversationRunState['status']): ConversationRunState {
  return { conversationId, projectId: null, status, hasUnreadResult: false, updatedAt: 0 }
}

describe('staleRunStates', () => {
  it('只挑 running 且主进程里已无对应 run 的会话', () => {
    const states = [state('c1', 'running'), state('c2', 'running'), state('c3', 'completed')]
    expect(staleRunStates(states, new Set(['c2'])).map((item) => item.conversationId)).toEqual(['c1'])
  })

  it('没有活跃 run 时全部 running 都算失联', () => {
    const states = [state('c1', 'running'), state('c2', 'running')]
    expect(staleRunStates(states, new Set()).map((item) => item.conversationId)).toEqual(['c1', 'c2'])
  })

  it('非 running 的状态不受影响', () => {
    expect(staleRunStates([state('c1', 'failed'), state('c2', 'waiting_user')], new Set())).toEqual([])
  })
})
