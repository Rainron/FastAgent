import { describe, expect, it } from 'vitest'
import { formatDuration, groupTodosByPhase, sortTodoItems, todoStats, todoSummary } from './todo-status'
import type { AgentEvent, TodoItem } from '../../shared/types'

function item(patch: Partial<TodoItem>): TodoItem {
  return { id: 't', content: '任务', status: 'pending', ...patch }
}

describe('formatDuration', () => {
  it('不足一分钟只显示秒', () => {
    expect(formatDuration(26_000)).toBe('26s')
  })

  it('超过一分钟显示分与秒', () => {
    expect(formatDuration(522_000)).toBe('8m 42s')
  })

  it('负值按 0 处理', () => {
    expect(formatDuration(-5)).toBe('0s')
  })
})

describe('sortTodoItems', () => {
  it('始终按 position 升序展示，与任务状态无关', () => {
    const items = [
      item({ id: '3', status: 'in_progress', position: 2 }),
      item({ id: '1', status: 'completed', position: 0 }),
      item({ id: '2', status: 'pending', position: 1 })
    ]
    expect(sortTodoItems(items).map((entry) => entry.id)).toEqual(['1', '2', '3'])
  })

  it('position 缺失或并列时保持原始顺序', () => {
    const items = [item({ id: 'b', position: 1 }), item({ id: 'a' }), item({ id: 'c', position: 0 })]
    expect(sortTodoItems(items).map((entry) => entry.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('todoStats', () => {
  const items = [
    item({ id: '1', status: 'completed', position: 0 }),
    item({ id: '2', status: 'in_progress', content: '公共基础设施', position: 1 }),
    item({ id: '3', status: 'pending', position: 2 })
  ]

  it('统计完成、待执行与当前阶段', () => {
    const stats = todoStats(items)
    expect(stats).toMatchObject({ total: 3, completed: 1, pending: 1, stage: 2, percent: 33 })
    expect(stats.current?.id).toBe('2')
  })

  // 此前 failed 统计的是 status === 'cancelled'，两者混为一谈；引入独立 failed 态后分开计数。
  it('cancelled 与 failed 分开计数', () => {
    const stats = todoStats([item({ id: '1', status: 'completed' }), item({ id: '2', status: 'cancelled' }), item({ id: '3', status: 'failed' })])
    expect(stats).toMatchObject({ total: 3, completed: 1, cancelled: 1, failed: 1, pending: 0 })
  })

  it('七态各自计数互不串台', () => {
    const stats = todoStats([
      item({ id: '1', status: 'pending', position: 0 }),
      item({ id: '2', status: 'in_progress', position: 1 }),
      item({ id: '3', status: 'completed', position: 2 }),
      item({ id: '4', status: 'cancelled', position: 3 }),
      item({ id: '5', status: 'blocked', position: 4 }),
      item({ id: '6', status: 'failed', position: 5 }),
      item({ id: '7', status: 'skipped', position: 6 })
    ])
    expect(stats).toMatchObject({ total: 7, pending: 1, completed: 1, cancelled: 1, blocked: 1, failed: 1, skipped: 1 })
    expect(stats.current?.id).toBe('2')
  })

  it('blocked 仍算未结算，阶段号停在它身上', () => {
    const stats = todoStats([
      item({ id: '1', status: 'completed', position: 0 }),
      item({ id: '2', status: 'blocked', position: 1 }),
      item({ id: '3', status: 'pending', position: 2 })
    ])
    expect(stats.stage).toBe(2)
    expect(stats.blocked).toBe(1)
  })

  it('skipped 已结算，不会把阶段号卡住', () => {
    const stats = todoStats([
      item({ id: '1', status: 'completed', position: 0 }),
      item({ id: '2', status: 'skipped', position: 1 }),
      item({ id: '3', status: 'pending', position: 2 })
    ])
    expect(stats.stage).toBe(3)
  })

  it('全部完成时阶段号等于总数', () => {
    expect(todoStats([item({ id: '1', status: 'completed' })]).stage).toBe(1)
  })

  it('空列表不产生除零', () => {
    expect(todoStats([])).toMatchObject({ total: 0, percent: 0, stage: 0, current: null })
  })
})

describe('groupTodosByPhase', () => {
  it('全部无 phase 时只返回一个未分组的组，顺序与扁平排序一致', () => {
    const items = [item({ id: '2', position: 1 }), item({ id: '1', position: 0 })]
    const groups = groupTodosByPhase(items)
    expect(groups).toHaveLength(1)
    expect(groups[0].phase).toBeNull()
    expect(groups[0].items.map((entry) => entry.id)).toEqual(['1', '2'])
  })

  it('按 phasePosition 排序分组，组内按 position 排序', () => {
    const items = [
      item({ id: 'b1', position: 2, phase: '实施', phasePosition: 2 }),
      item({ id: 'a2', position: 1, phase: '准备', phasePosition: 1 }),
      item({ id: 'a1', position: 0, phase: '准备', phasePosition: 1 })
    ]
    const groups = groupTodosByPhase(items)
    expect(groups.map((group) => group.phase)).toEqual(['准备', '实施'])
    expect(groups[0].items.map((entry) => entry.id)).toEqual(['a1', 'a2'])
    expect(groups[1].items.map((entry) => entry.id)).toEqual(['b1'])
  })

  it('混合输入里没有 phase 的条目单独成组，不会丢失', () => {
    const items = [
      item({ id: 'x', position: 0 }),
      item({ id: 'y', position: 1, phase: '验证', phasePosition: 1 })
    ]
    const groups = groupTodosByPhase(items)
    expect(groups.map((group) => group.phase)).toEqual([null, '验证'])
    expect(groups.flatMap((group) => group.items).map((entry) => entry.id)).toEqual(['x', 'y'])
  })

  it('同组内个别条目缺 phasePosition 时不把整组拉到最前', () => {
    const items = [
      item({ id: 'a', position: 0, phase: '准备', phasePosition: 1 }),
      item({ id: 'b', position: 1, phase: '实施', phasePosition: 2 }),
      item({ id: 'c', position: 2, phase: '实施' })
    ]
    expect(groupTodosByPhase(items).map((group) => group.phase)).toEqual(['准备', '实施'])
  })
})

describe('todoSummary', () => {
  function event(patch: Partial<AgentEvent>): AgentEvent {
    return { runId: 'r1', type: 'tool_started', ...patch }
  }

  it('只统计 file_changed 与 shell 命令', () => {
    const summary = todoSummary([
      event({ type: 'file_changed' }),
      event({ type: 'file_changed', path: 'b.ts' }),
      event({ tool: 'bash' }),
      event({ tool: 'read' }),
      event({ type: 'token' })
    ])
    expect(summary).toEqual({ files: 2, commands: 1 })
  })
})
