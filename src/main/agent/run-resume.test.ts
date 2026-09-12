import { describe, expect, it } from 'vitest'
import type { TodoItem } from '../../shared/types'
import { buildResumePrompt, isResumable, pendingTodos } from './run-resume'

function todo(patch: Partial<TodoItem>): TodoItem {
  return { id: 't', content: '任务', status: 'pending', ...patch }
}

describe('pendingTodos', () => {
  it('已结算的三态不再列出', () => {
    const items = [
      todo({ id: '1', status: 'completed' }),
      todo({ id: '2', status: 'cancelled' }),
      todo({ id: '3', status: 'skipped' })
    ]
    expect(pendingTodos(items)).toEqual([])
  })

  it('failed 与 blocked 要保留：它们是待处理的问题而不是已完成', () => {
    const items = [
      todo({ id: '1', status: 'failed' }),
      todo({ id: '2', status: 'blocked' }),
      todo({ id: '3', status: 'in_progress' }),
      todo({ id: '4', status: 'pending' })
    ]
    expect(pendingTodos(items).map((item) => item.id)).toEqual(['1', '2', '3', '4'])
  })
})

describe('buildResumePrompt', () => {
  it('说明中断原因、原始请求并明确禁止重头再来', () => {
    const prompt = buildResumePrompt({ goal: '把登录页改成暗色', reason: '任务已中断', todos: [], changedFiles: 0 })
    expect(prompt).toContain('中断原因：任务已中断')
    expect(prompt).toContain('原始请求：把登录页改成暗色')
    expect(prompt).toContain('不要重头执行整个任务')
  })

  it('已改动的文件要提醒不要重做', () => {
    const prompt = buildResumePrompt({ goal: 'x', reason: null, todos: [], changedFiles: 4 })
    expect(prompt).toContain('已经改动了 4 个文件')
    expect(prompt).not.toContain('中断原因')
  })

  it('未完成待办带阶段名与状态标注', () => {
    const prompt = buildResumePrompt({
      goal: 'x',
      reason: null,
      todos: [
        todo({ id: '1', content: '建表', status: 'completed', phase: '准备' }),
        todo({ id: '2', content: '接线', status: 'blocked', phase: '实施' }),
        todo({ id: '3', content: '跑测试', status: 'failed' })
      ],
      changedFiles: 0
    })
    expect(prompt).toContain('- [实施] 接线（阻塞）')
    expect(prompt).toContain('- 跑测试（上次失败）')
    // 已完成的不进提示，避免模型重做
    expect(prompt).not.toContain('建表')
  })

  it('待办过多时截断并说明剩余条数，不把整份计划塞回 prompt', () => {
    const todos = Array.from({ length: 12 }, (_, index) => todo({ id: String(index), content: `任务${index}` }))
    const prompt = buildResumePrompt({ goal: 'x', reason: null, todos, changedFiles: 0 })
    expect(prompt).toContain('…另有 4 项')
    expect(prompt).not.toContain('任务9')
  })

  it('超长原始请求被截断', () => {
    const prompt = buildResumePrompt({ goal: 'a'.repeat(600), reason: null, todos: [], changedFiles: 0 })
    expect(prompt).toContain('…')
    expect(prompt.length).toBeLessThan(900)
  })

  it('没有待办也没有改动时仍是一段可用提示', () => {
    const prompt = buildResumePrompt({ goal: '继续', reason: null, todos: [], changedFiles: 0 })
    expect(prompt).toContain('上一轮任务被中断')
    expect(prompt).not.toContain('未完成的待办')
  })
})

describe('isResumable', () => {
  it('有未完成待办或已改文件才值得续跑', () => {
    expect(isResumable({ pendingTodos: 2, changedFiles: 0 })).toBe(true)
    expect(isResumable({ pendingTodos: 0, changedFiles: 3 })).toBe(true)
  })

  it('全部做完之后才中断的没有续跑价值', () => {
    expect(isResumable({ pendingTodos: 0, changedFiles: 0 })).toBe(false)
  })
})
