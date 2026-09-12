import { describe, expect, it } from 'vitest'
import { normalizeServerUrl, removeRecentServer, upsertRecentServer } from './servers'

describe('normalizeServerUrl', () => {
  it('去掉首尾空白与结尾斜杠', () => {
    expect(normalizeServerUrl('  http://localhost:10001/  ')).toBe('http://localhost:10001')
    expect(normalizeServerUrl('http://localhost:10001///')).toBe('http://localhost:10001')
  })
})

describe('upsertRecentServer', () => {
  it('把最近使用的地址提到最前并去重', () => {
    expect(upsertRecentServer(['a', 'b'], 'b')).toEqual(['b', 'a'])
    expect(upsertRecentServer(['a'], 'a/')).toEqual(['a'])
  })

  it('忽略空地址并限制条数', () => {
    expect(upsertRecentServer(['a'], '   ')).toEqual(['a'])
    expect(upsertRecentServer(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })
})

describe('removeRecentServer', () => {
  it('按归一化后的地址删除', () => {
    expect(removeRecentServer(['a', 'b'], 'a/')).toEqual(['b'])
  })
})
