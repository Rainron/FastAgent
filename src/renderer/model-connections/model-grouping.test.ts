import { describe, expect, it } from 'vitest'
import { groupByModelPrefix, modelPrefix } from './model-grouping'

describe('modelPrefix', () => {
  it('带命名空间的 id 按命名空间归组', () => {
    expect(modelPrefix('anthropic/claude-sonnet-4')).toBe('anthropic')
  })
  it('普通 id 取第一个分隔符前的词', () => {
    expect(modelPrefix('gpt-4o-mini')).toBe('gpt')
    expect(modelPrefix('deepseek-reasoner')).toBe('deepseek')
    expect(modelPrefix('qwen2.5-72b')).toBe('qwen2')
  })
  it('没有分隔符或前缀过短时不归组', () => {
    expect(modelPrefix('o3')).toBe('')
    expect(modelPrefix('x-1')).toBe('')
    expect(modelPrefix('  ')).toBe('')
  })
})

describe('groupByModelPrefix', () => {
  it('同前缀成组，独苗拍平', () => {
    const groups = groupByModelPrefix([
      { id: 'gpt-4o' }, { id: 'deepseek-chat' }, { id: 'gpt-5' }, { id: 'kimi-k2' }
    ])
    expect(groups.map((group) => [group.prefix, group.items.map((item) => item.id)])).toEqual([
      ['gpt', ['gpt-4o', 'gpt-5']],
      ['', ['deepseek-chat']],
      ['', ['kimi-k2']]
    ])
  })
  it('保持首次出现顺序，不打乱厂商返回的排序', () => {
    const groups = groupByModelPrefix([{ id: 'b-1' }, { id: 'anthropic/a' }, { id: 'anthropic/b' }])
    expect(groups.map((group) => group.prefix)).toEqual(['', 'anthropic'])
  })
})
