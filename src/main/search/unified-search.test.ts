import { describe, expect, it, vi } from 'vitest'
import type { SearchResult, SearchResultKind } from '../../shared/types'
import { makeSnippet, normalizeSearchQuery, runUnifiedSearch, type SearchProviders } from './unified-search'

function result(kind: SearchResultKind, patch: Partial<SearchResult> = {}): SearchResult {
  return { kind, id: `${kind}-1`, title: kind, snippet: '', projectId: null, locator: null, updatedAt: 1, ...patch }
}

function providers(overrides: Partial<SearchProviders> = {}): SearchProviders {
  const empty = () => []
  return { conversation: empty, knowledge: empty, skill: empty, artifact: empty, ...overrides }
}

describe('makeSnippet', () => {
  it('围绕命中词截取并压平空白', () => {
    const text = `${'a'.repeat(100)}\n关键词\n${'b'.repeat(100)}`
    const snippet = makeSnippet(text, '关键词', 5)
    // 换行压成空格后也占窗口，所以两侧各是 4 个字符加一个空格
    expect(snippet).toBe('…aaaa 关键词 bbbb…')
  })

  it('没命中时退回开头一段，不返回空串', () => {
    expect(makeSnippet('一段正文内容', '不存在')).toBe('一段正文内容')
  })

  it('大小写不敏感', () => {
    expect(makeSnippet('Hello World', 'hello', 2)).toContain('Hello')
  })

  it('空正文给空串', () => {
    expect(makeSnippet('   ', 'x')).toBe('')
  })
})

describe('normalizeSearchQuery', () => {
  it('不传 kinds 时四类全查', () => {
    expect(normalizeSearchQuery({ keyword: 'x' }).kinds).toEqual(['conversation', 'knowledge', 'skill', 'artifact'])
  })

  it('limit 夹在 1..100', () => {
    expect(normalizeSearchQuery({ keyword: 'x', limit: 0 }).limit).toBe(1)
    expect(normalizeSearchQuery({ keyword: 'x', limit: 999 }).limit).toBe(100)
  })
})

describe('runUnifiedSearch', () => {
  it('空关键词不查任何一类', () => {
    const conversation = vi.fn(() => [])
    expect(runUnifiedSearch({ keyword: '  ' }, providers({ conversation }))).toEqual({ results: [], truncated: false })
    expect(conversation).not.toHaveBeenCalled()
  })

  it('跨类按更新时间倒序合并', () => {
    const response = runUnifiedSearch({ keyword: 'x' }, providers({
      conversation: () => [result('conversation', { updatedAt: 10 })],
      artifact: () => [result('artifact', { updatedAt: 30 })],
      knowledge: () => [result('knowledge', { updatedAt: 20 })]
    }))
    expect(response.results.map((item) => item.kind)).toEqual(['artifact', 'knowledge', 'conversation'])
  })

  it('按项目过滤时 Skill 整类退出，不逐条过滤', () => {
    const skill = vi.fn(() => [result('skill')])
    const response = runUnifiedSearch({ keyword: 'x', projectId: 'p1' }, providers({ skill }))
    expect(skill).not.toHaveBeenCalled()
    expect(response.results).toEqual([])
  })

  it('只查指定类别', () => {
    const knowledge = vi.fn(() => [result('knowledge')])
    const conversation = vi.fn(() => [result('conversation')])
    runUnifiedSearch({ keyword: 'x', kinds: ['knowledge'] }, providers({ knowledge, conversation }))
    expect(knowledge).toHaveBeenCalled()
    expect(conversation).not.toHaveBeenCalled()
  })

  it('某一类达到上限时标记截断', () => {
    const response = runUnifiedSearch({ keyword: 'x', kinds: ['artifact'], limit: 2 }, providers({
      artifact: () => [result('artifact', { id: 'a' }), result('artifact', { id: 'b' }), result('artifact', { id: 'c' })]
    }))
    expect(response.truncated).toBe(true)
    expect(response.results).toHaveLength(2)
  })
})
