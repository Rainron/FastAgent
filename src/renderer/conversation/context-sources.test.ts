import { describe, expect, it } from 'vitest'
import type { TurnContextSource } from '../../shared/types'
import { canOpenSource, groupContextSources, summarizeContextSources } from './context-sources'

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

describe('canOpenSource', () => {
  it('只有带路径的来源可打开', () => {
    expect(canOpenSource(source({ kind: 'rule', locator: 'K:/repo/AGENTS.md' }))).toBe(true)
    expect(canOpenSource(source())).toBe(false)
  })
})
