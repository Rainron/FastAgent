import { describe, expect, it } from 'vitest'
import { projectRunStatus, runStatusPresentation, type ConversationRunState } from './run-status'

const state = (status: ConversationRunState['status'], unread = false, projectId: string | null = 'p1'): ConversationRunState => ({ conversationId: status, projectId, status, hasUnreadResult: unread, updatedAt: 1 })

describe('run status presentation', () => {
  it('只为需要展示的状态生成状态点', () => {
    expect(runStatusPresentation(state('running'))).toMatchObject({ tone: 'running', label: '正在执行' })
    expect(runStatusPresentation(state('completed', true))).toMatchObject({ tone: 'completed', label: '任务已完成' })
    expect(runStatusPresentation(state('failed', true))).toMatchObject({ tone: 'failed', label: '执行失败' })
    expect(runStatusPresentation(state('cancelled', true))).toMatchObject({ tone: 'cancelled', label: '已取消' })
    expect(runStatusPresentation(state('completed'))).toBeNull()
    expect(runStatusPresentation(state('cancelled'))).toBeNull()
  })
  it('按等待、失败、运行、完成、取消聚合项目状态', () => {
    expect(projectRunStatus([state('running'), state('failed', true), state('waiting_user')], 'p1')?.status).toBe('waiting_user')
    expect(projectRunStatus([state('completed', true), state('cancelled')], 'p1')?.status).toBe('completed')
  })
})
