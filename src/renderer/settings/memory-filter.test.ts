import { describe, expect, it } from 'vitest'
import { defaultCreateScope, describeMemoryClearTarget, describeMemoryScope, describeMemorySource, memoryClearTarget, memoryCreateScope, memoryExtractModelChoices, memoryListQuery } from './memory-filter'

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

describe('describeMemorySource', () => {
  it('有来源会话时给标题并可跳转', () => {
    expect(describeMemorySource({ sourceConversationId: 'c1', sourceConversationTitle: '重构登录' })).toEqual({ label: '重构登录', conversationId: 'c1' })
    expect(describeMemorySource({ sourceConversationId: 'c1', sourceConversationTitle: '' })).toEqual({ label: '未命名对话', conversationId: 'c1' })
  })
  it('会话已删除时不给跳转，也不露出裸 id', () => {
    expect(describeMemorySource({ sourceConversationId: 'c1', sourceConversationTitle: null })).toEqual({ label: '来源对话已删除', conversationId: null })
  })
  it('没有来源会话的是手动添加', () => {
    expect(describeMemorySource({ sourceConversationId: null, sourceConversationTitle: null })).toEqual({ label: '手动添加', conversationId: null })
  })
})

describe('新增记忆的作用域', () => {
  it('跟着当前筛选走，筛选是全部时落到当前项目', () => {
    expect(defaultCreateScope({ kind: 'project', projectId: 'p2' }, 'p1', ['p1', 'p2'])).toBe('p2')
    expect(defaultCreateScope({ kind: 'global' }, 'p1', ['p1'])).toBe('global')
    expect(defaultCreateScope({ kind: 'all' }, 'p1', ['p1'])).toBe('p1')
  })
  it('当前项目已不在列表或没有项目时落到全局', () => {
    expect(defaultCreateScope({ kind: 'all' }, 'gone', ['p1'])).toBe('global')
    expect(defaultCreateScope({ kind: 'all' }, null, ['p1'])).toBe('global')
  })
  it('下拉值转成创建参数', () => {
    expect(memoryCreateScope('global')).toEqual({ scope: 'global', scopeId: null })
    expect(memoryCreateScope('p1')).toEqual({ scope: 'workspace', scopeId: 'p1' })
  })
})

