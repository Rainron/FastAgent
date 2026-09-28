import { describe, expect, it } from 'vitest'
import { findOccurrences, stepMatchIndex } from './find-in-text'

describe('findOccurrences', () => {
  it('找出全部命中并给出区间', () => {
    expect(findOccurrences('abcbc', 'bc')).toEqual([
      { start: 1, end: 3 },
      { start: 3, end: 5 }
    ])
  })

  it('命中不重叠：aaa 查 aa 只算一处', () => {
    expect(findOccurrences('aaa', 'aa')).toEqual([{ start: 0, end: 2 }])
  })

  it('默认大小写不敏感', () => {
    expect(findOccurrences('Fast fast', 'FAST')).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 }
    ])
  })

  it('显式区分大小写', () => {
    expect(findOccurrences('Fast fast', 'FAST', { caseSensitive: true })).toEqual([])
    expect(findOccurrences('Fast fast', 'Fast', { caseSensitive: true })).toEqual([{ start: 0, end: 4 }])
  })

  it('空查询或无命中返回空数组', () => {
    expect(findOccurrences('任意', '')).toEqual([])
    expect(findOccurrences('abc', 'x')).toEqual([])
  })

  it('中文按字符定位区间', () => {
    expect(findOccurrences('上下文上下文', '上下')).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 }
    ])
  })
})

describe('stepMatchIndex', () => {
  it('正向到末尾后回绕到开头', () => {
    expect(stepMatchIndex(0, 1, 3)).toBe(1)
    expect(stepMatchIndex(2, 1, 3)).toBe(0)
  })

  it('反向到开头前回绕到末尾', () => {
    expect(stepMatchIndex(0, -1, 3)).toBe(2)
    expect(stepMatchIndex(1, -1, 3)).toBe(0)
  })

  it('无命中时恒为 0', () => {
    expect(stepMatchIndex(2, 1, 0)).toBe(0)
  })
})
