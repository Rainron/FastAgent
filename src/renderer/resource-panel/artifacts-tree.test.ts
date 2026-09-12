import { describe, expect, it } from 'vitest'
import type { ArtifactGroup } from '../../shared/types'
import { filterArtifactGroups, formatArtifactTime } from './artifacts-tree'

function group(overrides: Partial<ArtifactGroup>): ArtifactGroup {
  return {
    id: 'g1',
    name: '分析项目架构',
    count: 1,
    artifacts: [{ id: 'a1', workspaceId: 'D:/p', name: 'plan.md', type: 'plan', path: 'task_plan.md', createdAt: 1, updatedAt: 1 }],
    ...overrides
  }
}

describe('filterArtifactGroups', () => {
  const groups = [
    group({
      id: 'c1', name: '分析项目架构', artifacts: [
        { id: 'a1', workspaceId: 'D:/p', name: 'task_plan.md', type: 'plan', createdAt: 1, updatedAt: 1 },
        { id: 'a2', workspaceId: 'D:/p', name: 'main.ts', type: 'code', createdAt: 2, updatedAt: 2 }
      ]
    }),
    group({ id: 'c2', name: '修复测试失败', artifacts: [{ id: 'b1', workspaceId: 'D:/p', name: 'test-result.md', type: 'test-result', createdAt: 3, updatedAt: 3 }] })
  ]

  it('空关键字返回原分组', () => {
    expect(filterArtifactGroups(groups, '  ')).toBe(groups)
  })

  it('命中组名（任务名）保留整组', () => {
    const result = filterArtifactGroups(groups, '修复')
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('c2')
    expect(result[0].count).toBe(1)
  })

  it('命中条目名只保留匹配条目并重算计数', () => {
    const result = filterArtifactGroups(groups, 'plan')
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('c1')
    expect(result[0].count).toBe(1)
    expect(result[0].artifacts.map((item) => item.id)).toEqual(['a1'])
  })

  it('按类型搜索', () => {
    const result = filterArtifactGroups(groups, 'test-result')
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('c2')
  })

  it('无匹配返回空数组', () => {
    expect(filterArtifactGroups(groups, '不存在')).toEqual([])
  })
})

describe('formatArtifactTime', () => {
  it('非法时间返回空串', () => {
    expect(formatArtifactTime(Number.NaN)).toBe('')
  })
})
