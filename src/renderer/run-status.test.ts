import { describe, expect, it } from 'vitest'
import { hasUnreadResultFor, projectRunStatus, runStatusPresentation, type ConversationRunState } from './run-status'

const state = (status: ConversationRunState['status'], unread = false, projectId: string | null = 'p1'): ConversationRunState => ({ conversationId: status, projectId, status, hasUnreadResult: unread, updatedAt: 1 })

describe('run status presentation', () => {
  it('只为需要展示的状态生成状态点', () => {
    expect(runStatusPresentation(state('running'))).toMatchObject({ tone: 'running', label: '正在执行' })
    expect(runStatusPresentation(state('completed', true))).toMatchObject({ tone: 'completed', label: '已完成，有未查看的结果' })
    expect(runStatusPresentation(state('failed', true))).toMatchObject({ tone: 'failed', label: '执行失败，尚未查看' })
    expect(runStatusPresentation(state('cancelled', true))).toMatchObject({ tone: 'cancelled', label: '运行被中断，尚未查看' })
    expect(runStatusPresentation(state('completed'))).toBeNull()
    expect(runStatusPresentation(state('cancelled'))).toBeNull()
  })
  it('按等待、失败、运行、完成、取消聚合项目状态', () => {
    expect(projectRunStatus([state('running'), state('failed', true), state('waiting_user')], 'p1')?.status).toBe('waiting_user')
    expect(projectRunStatus([state('completed', true), state('cancelled')], 'p1')?.status).toBe('completed')
  })
  it('用户自己停止的运行不留未读，被动中断才提醒', () => {
    expect(hasUnreadResultFor('completed')).toBe(true)
    expect(hasUnreadResultFor('failed')).toBe(true)
    expect(hasUnreadResultFor('interrupted')).toBe(true)
    expect(hasUnreadResultFor('cancelled')).toBe(false)
    expect(hasUnreadResultFor('run_started')).toBe(false)
  })
})
