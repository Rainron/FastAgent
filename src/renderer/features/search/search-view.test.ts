import { describe, expect, it } from 'vitest'
import type { SearchResult } from '../../../shared/types'
import { countByKind, effectiveKinds, resultLocationLabel, SEARCH_KINDS, skillScopeNotice, toggleKind } from './search-view'

function result(patch: Partial<SearchResult> = {}): SearchResult {
  return { kind: 'knowledge', id: '1', title: 't', snippet: '', projectId: null, locator: null, updatedAt: 1, ...patch }
}

describe('effectiveKinds', () => {
  it('一个都不选等于全选', () => {
    expect(effectiveKinds([])).toEqual(SEARCH_KINDS)
  })

  it('选了就只用选中的', () => {
    expect(effectiveKinds(['skill'])).toEqual(['skill'])
  })
})

describe('toggleKind', () => {
  it('来回切换', () => {
    expect(toggleKind([], 'skill')).toEqual(['skill'])
    expect(toggleKind(['skill', 'artifact'], 'skill')).toEqual(['artifact'])
  })
})

describe('countByKind', () => {
  it('分类计数，未命中的类为 0', () => {
    expect(countByKind([result(), result({ kind: 'skill' })])).toEqual({ conversation: 0, knowledge: 1, skill: 1, artifact: 0 })
  })
})

describe('resultLocationLabel', () => {
  it('知识与成果给定位，会话不给', () => {
    expect(resultLocationLabel(result({ locator: 'docs/a.md L3-9' }))).toBe('docs/a.md L3-9')
    expect(resultLocationLabel(result({ kind: 'conversation', locator: 'x' }))).toBe('')
  })

  it('没有定位时给空串', () => {
    expect(resultLocationLabel(result())).toBe('')
  })
})

describe('skillScopeNotice', () => {
  it('按项目筛选时说明 Skill 不参与，全部范围时不打扰', () => {
    expect(skillScopeNotice('p1')).toContain('不参与搜索')
    expect(skillScopeNotice('all')).toBe('')
  })
})
