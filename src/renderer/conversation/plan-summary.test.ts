import { describe, expect, it } from 'vitest'
import type { ConversationTurn, TodoItem } from '../../shared/types'
import { conversationPlans, planGroupStatus, planOverallLabel, planOverallStatus, planProgress } from './plan-summary'

const turn = (id: string) => ({ id, userMessage: { text: id } } as ConversationTurn)
const item = (id: string, status: TodoItem['status']): TodoItem => ({ id, content: id, status })

describe('plan-summary', () => {
  it('按回合汇总并过滤无计划回合', () => {
    const groups = conversationPlans([turn('a'), turn('b')], { a: [item('x', 'completed')] })
    expect(groups.map((group) => group.turn.id)).toEqual(['a'])
  })
  it('计算总体状态与进度', () => {
    const groups = [{ turn: turn('a'), items: [item('x', 'completed'), item('y', 'in_progress')] }]
    expect(planOverallStatus(groups)).toBe('working')
    expect(planProgress(groups)).toMatchObject({ completed: 1, total: 2, percent: 50 })
  })
  it('单组状态按 in_progress > failed > blocked > pending 取优先级', () => {
    expect(planGroupStatus([item('x', 'failed'), item('y', 'in_progress')])).toBe('working')
    expect(planGroupStatus([item('x', 'failed'), item('y', 'blocked')])).toBe('failed')
    expect(planGroupStatus([item('x', 'blocked'), item('y', 'pending')])).toBe('blocked')
    expect(planGroupStatus([item('x', 'completed'), item('y', 'pending')])).toBe('pending')
    expect(planGroupStatus([item('x', 'completed'), item('y', 'skipped')])).toBe('done')
    expect(planGroupStatus([])).toBe('done')
  })
  it('总体状态有中文文案', () => {
    expect(planOverallLabel('working')).toBe('进行中')
    expect(planOverallLabel('done')).toBe('已完成')
    expect(planOverallLabel('blocked')).toBe('已阻塞')
    expect(planOverallLabel('failed')).toBe('失败')
    expect(planOverallLabel('pending')).toBe('待处理')
  })
})
