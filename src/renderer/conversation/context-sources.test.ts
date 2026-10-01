import { describe, expect, it } from 'vitest'
import type { TurnContextSource } from '../../shared/types'
import { CONTEXT_GROUP_PREVIEW, canOpenSource, groupContextSources, summarizeContextSources, visibleGroupItems } from './context-sources'

function source(patch: Partial<TurnContextSource> = {}): TurnContextSource {
  return { kind: 'kb', refId: 'kb-1', title: '部署约定', locator: null, detail: null, recordedAt: 1, ...patch }
}

describe('groupContextSources', () => {
  it('按知识 / 规则 / Skill 的固定顺序分组，空组不出现', () => {
    const groups = groupContextSources([
      source({ kind: 'skill', refId: 'code-review' }),
      source({ kind: 'kb', refId: 'kb-1' })
    ])
    expect(groups.map((group) => group.kind)).toEqual(['kb', 'skill'])
    expect(groups.map((group) => group.label)).toEqual(['项目知识', '可选中的 Skill'])
  })

  it('没有来源时返回空数组', () => {
    expect(groupContextSources([])).toEqual([])
  })
})

describe('summarizeContextSources', () => {
  it('折叠态摘要按组给条数', () => {
    const text = summarizeContextSources([
      source({ kind: 'kb', refId: 'kb-1' }),
      source({ kind: 'kb', refId: 'kb-2' }),
      source({ kind: 'rule', refId: 'AGENTS.md' })
    ])
    expect(text).toBe('项目知识 2 · 项目规则 1')
  })

  it('无来源时为空串', () => {
    expect(summarizeContextSources([])).toBe('')
  })
})

describe('visibleGroupItems', () => {
  const many = Array.from({ length: CONTEXT_GROUP_PREVIEW + 3 }, (_, index) => source({ kind: 'skill', refId: `s-${index}` }))

  it('折叠时截断到预览条数', () => {
    expect(visibleGroupItems(many, false)).toHaveLength(CONTEXT_GROUP_PREVIEW)
  })

  it('展开后给全量', () => {
    expect(visibleGroupItems(many, true)).toHaveLength(many.length)
  })

  it('不超过预览条数时折叠态也给全量', () => {
    const few = many.slice(0, CONTEXT_GROUP_PREVIEW)
    expect(visibleGroupItems(few, false)).toHaveLength(few.length)
  })

  it('不修改传入的数组', () => {
    const copy = [...many]
    visibleGroupItems(many, true).push(source())
    expect(many).toEqual(copy)
  })
})

describe('groupContextSources 组说明', () => {
  it('只有 Skill 组带整组共用的说明', () => {
    const groups = groupContextSources([source({ kind: 'skill', refId: 'a' }), source({ kind: 'kb', refId: 'b' })])
    expect(groups.find((group) => group.kind === 'kb')?.note).toBeNull()
    expect(groups.find((group) => group.kind === 'skill')?.note).toContain('正文')
  })
})

describe('canOpenSource', () => {
  it('只有带路径的来源可打开', () => {
    expect(canOpenSource(source({ kind: 'rule', locator: 'K:/repo/AGENTS.md' }))).toBe(true)
    expect(canOpenSource(source())).toBe(false)
  })
})
