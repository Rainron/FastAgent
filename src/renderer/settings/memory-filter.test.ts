import { describe, expect, it } from 'vitest'
import { describeMemoryClearTarget, describeMemoryScope, memoryClearTarget, memoryExtractModelChoices, memoryListQuery } from './memory-filter'

describe('memoryListQuery', () => {
  it('全部作用域不带 scope 条件', () => {
    expect(memoryListQuery({ kind: 'all' }, 1, 20)).toEqual({ page: 1, pageSize: 20, keyword: undefined })
  })

  it('项目筛选按 projectId 过滤 workspace 作用域', () => {
    expect(memoryListQuery({ kind: 'project', projectId: 'p1' }, 2, 10)).toMatchObject({ scope: 'workspace', scopeId: 'p1', page: 2 })
  })

  it('空白关键词不进查询条件', () => {
    expect(memoryListQuery({ kind: 'global' }, 1, 20, '   ').keyword).toBeUndefined()
    expect(memoryListQuery({ kind: 'global' }, 1, 20, ' uv ').keyword).toBe('uv')
  })
})

describe('memoryClearTarget', () => {
  it('全部作用域不带参数，主进程据此清空账户全部记忆', () => {
    expect(memoryClearTarget({ kind: 'all' })).toEqual({})
  })

  it('全局与项目分别限定 scope', () => {
    expect(memoryClearTarget({ kind: 'global' })).toEqual({ scope: 'global', scopeId: null })
    expect(memoryClearTarget({ kind: 'project', projectId: 'p1' })).toEqual({ scope: 'workspace', scopeId: 'p1' })
  })

  it('清空提示语区分作用域', () => {
    expect(describeMemoryClearTarget({ kind: 'all' })).toContain('全部')
    expect(describeMemoryClearTarget({ kind: 'project', projectId: 'p1' }, 'FastAgent')).toContain('FastAgent')
  })
})

describe('memoryExtractModelChoices', () => {
  const models = [
    { id: 1, provider: 'anthropic', model_name: 'claude-haiku-4-5' },
    { id: -2, provider: '本地 Ollama', model_name: 'qwen3' }
  ]

  it('按提供商与模型名生成选项，跟随会话模型时不补额外项', () => {
    expect(memoryExtractModelChoices(models, null)).toEqual([
      { id: 1, label: 'anthropic · claude-haiku-4-5', missing: false },
      { id: -2, label: '本地 Ollama · qwen3', missing: false }
    ])
  })

  it('已选模型不在列表时补一条失效项，避免选中值被静默丢掉', () => {
    const choices = memoryExtractModelChoices(models, 99)
    expect(choices[0]).toEqual({ id: 99, label: '已失效的模型 #99', missing: true })
    expect(choices).toHaveLength(3)
  })

  it('已选模型仍在列表时不重复补项', () => {
    expect(memoryExtractModelChoices(models, -2)).toHaveLength(2)
  })
})

describe('describeMemoryScope', () => {
  it('项目名缺失时不显示裸 id', () => {
    expect(describeMemoryScope({ scope: 'workspace', scopeId: 'p-removed' }, {})).toBe('项目 · 已移除的项目')
    expect(describeMemoryScope({ scope: 'workspace', scopeId: 'p1' }, { p1: 'FastAgent' })).toBe('项目 · FastAgent')
  })

  it('全局与 agent 作用域各有说明', () => {
    expect(describeMemoryScope({ scope: 'global', scopeId: null }, {})).toBe('全局')
    expect(describeMemoryScope({ scope: 'agent', scopeId: 'reviewer' }, {})).toContain('reviewer')
  })
})
