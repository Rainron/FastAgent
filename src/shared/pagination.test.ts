import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_SIZE, normalizePageSize, pageOffset, pageSizeOptions, pageTokens, resolvePage, totalPages } from './pagination'

describe('normalizePageSize', () => {
  it('缺省或非法值回落到默认页长', () => {
    expect(normalizePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE)
    expect(normalizePageSize(0)).toBe(DEFAULT_PAGE_SIZE)
    expect(normalizePageSize(Number.NaN)).toBe(DEFAULT_PAGE_SIZE)
  })

  it('夹在 1..100 之间', () => {
    expect(normalizePageSize(1)).toBe(1)
    expect(normalizePageSize(50)).toBe(50)
    expect(normalizePageSize(1000)).toBe(100)
  })
})

describe('totalPages', () => {
  it('按页长向上取整', () => {
    expect(totalPages(156, 20)).toBe(8)
    expect(totalPages(160, 20)).toBe(8)
    expect(totalPages(161, 20)).toBe(9)
  })

  it('空结果也算一页', () => {
    expect(totalPages(0, 20)).toBe(1)
    expect(totalPages(-5, 20)).toBe(1)
  })
})

describe('resolvePage', () => {
  it('越界页夹回最后一页', () => {
    expect(resolvePage(99, 156, 20)).toBe(8)
    expect(resolvePage(3, 156, 20)).toBe(3)
  })

  it('小于 1 或缺省时回到第一页', () => {
    expect(resolvePage(0, 156, 20)).toBe(1)
    expect(resolvePage(-2, 156, 20)).toBe(1)
    expect(resolvePage(undefined, 156, 20)).toBe(1)
  })

  it('总数缩水后落到新的最后一页', () => {
    expect(resolvePage(8, 12, 20)).toBe(1)
  })
})

describe('pageSizeOptions', () => {
  it('预置档位原样返回', () => {
    expect(pageSizeOptions(20)).toEqual([10, 20, 50, 100])
  })

  it('非预置的当前值按序补进去', () => {
    expect(pageSizeOptions(30)).toEqual([10, 20, 30, 50, 100])
  })
})

describe('pageOffset', () => {
  it('第一页从 0 开始', () => {
    expect(pageOffset(1, 20)).toBe(0)
    expect(pageOffset(3, 20)).toBe(40)
  })
})

describe('pageTokens', () => {
  it('首页保留左侧三个页码并折叠尾部', () => {
    expect(pageTokens(1, 8)).toEqual([1, 2, 3, 'ellipsis', 8])
  })

  it('末页向左补齐窗口', () => {
    expect(pageTokens(8, 8)).toEqual([1, 'ellipsis', 6, 7, 8])
  })

  it('中间页两侧都折叠', () => {
    expect(pageTokens(5, 10)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 10])
  })

  it('折叠区只剩一页时直接显示页码', () => {
    expect(pageTokens(4, 8)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 8])
    expect(pageTokens(5, 8)).toEqual([1, 'ellipsis', 4, 5, 6, 7, 8])
  })

  it('总页数不足窗口时全部列出', () => {
    expect(pageTokens(1, 1)).toEqual([1])
    expect(pageTokens(2, 3)).toEqual([1, 2, 3])
  })

  it('当前页越界时按夹取后的页计算', () => {
    expect(pageTokens(99, 8)).toEqual([1, 'ellipsis', 6, 7, 8])
  })
})
