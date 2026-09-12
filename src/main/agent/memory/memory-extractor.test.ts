import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '../../../shared/types'
import { buildExtractionPrompt, MAX_CANDIDATES, MAX_CANDIDATE_CHARACTERS, parseMemoryCandidates, shouldExtractMemories } from './memory-extractor'

const record: MemoryRecord = {
  id: 'm1', scope: 'workspace', scopeId: 'p1', type: 'decision', content: '数据库使用 MySQL',
  importance: 4, confidence: 0.9, sourceConversationId: null, sourceTurnId: null, sourceRunId: null,
  status: 'active', supersededBy: null, createdAt: 0, updatedAt: 0, lastAccessedAt: null, expiresAt: null
}

describe('shouldExtractMemories', () => {
  it('挡掉无信息量的应答', () => {
    for (const userText of ['好的', '继续', 'OK', '谢谢！', '嗯嗯']) {
      expect(shouldExtractMemories({ userText, assistantText: '已完成' })).toBe(false)
    }
  })

  it('助手没有产出的回合不抽取', () => {
    expect(shouldExtractMemories({ userText: '本项目统一使用 uv', assistantText: '  ' })).toBe(false)
  })

  it('有实质内容的回合进入抽取', () => {
    expect(shouldExtractMemories({ userText: '本项目统一使用 uv', assistantText: '已记录' })).toBe(true)
  })
})

describe('buildExtractionPrompt', () => {
  it('未归属项目时只允许 global 作用域', () => {
    const prompt = buildExtractionPrompt({ userText: 'a', assistantText: 'b' }, [], false)
    expect(prompt).toContain('只能用 global')
  })

  it('既有记忆按序号列出，供模型声明替代关系', () => {
    expect(buildExtractionPrompt({ userText: 'a', assistantText: 'b' }, [record], true)).toContain('1. [decision] 数据库使用 MySQL')
  })
})

describe('parseMemoryCandidates', () => {
  it('解析类型、作用域与重要性', () => {
    const [candidate] = parseMemoryCandidates('- [decision|workspace|4] 当前项目数据库统一使用 PostgreSQL', true)
    expect(candidate).toMatchObject({ type: 'decision', scope: 'workspace', importance: 4, content: '当前项目数据库统一使用 PostgreSQL' })
  })

  it('解析替代声明并去重', () => {
    const [candidate] = parseMemoryCandidates('- [decision|workspace|4] 改用 PostgreSQL <替代:2,2,3>', true)
    expect(candidate.replaces).toEqual([2, 3])
  })

  it('NONE 与无法解析的行被忽略', () => {
    expect(parseMemoryCandidates('NONE\n随便一句话\n- 没有方括号', true)).toEqual([])
  })

  it('未知类型的行丢弃，不污染记忆', () => {
    expect(parseMemoryCandidates('- [随想|workspace|3] 一些闲聊', true)).toEqual([])
  })

  it('未归属项目时 workspace 作用域收敛到 global', () => {
    const [candidate] = parseMemoryCandidates('- [fact|workspace|3] 团队使用 pnpm', false)
    expect(candidate.scope).toBe('global')
  })

  it('缺省作用域按是否归属项目取默认值', () => {
    expect(parseMemoryCandidates('- [fact] 团队使用 pnpm', true)[0].scope).toBe('workspace')
    expect(parseMemoryCandidates('- [fact] 团队使用 pnpm', false)[0].scope).toBe('global')
  })

  it('重要性缺省为 3，内容超长被截断', () => {
    const [candidate] = parseMemoryCandidates(`- [fact] ${'长'.repeat(400)}`, true)
    expect(candidate.importance).toBe(3)
    expect(candidate.content).toHaveLength(MAX_CANDIDATE_CHARACTERS)
  })

  it('条数受上限约束', () => {
    const text = Array.from({ length: 9 }, (_, index) => `- [fact|global|3] 事实条目编号 ${index}`).join('\n')
    expect(parseMemoryCandidates(text, true)).toHaveLength(MAX_CANDIDATES)
  })
})
