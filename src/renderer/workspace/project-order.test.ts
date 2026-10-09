import { describe, expect, it, vi } from 'vitest'
import { applyProjectOrder, moveProjectId, shiftDirection, sortDropIndex, PROJECT_ORDER_KEY, readProjectOrder, writeProjectOrder } from './project-order'

const projects = [
  { id: 'c', name: 'charlie' },
  { id: 'a', name: 'alpha' },
  { id: 'b', name: 'bravo' }
]

describe('侧栏项目排序', () => {
  it('没有保存顺序时按名称排', () => {
    expect(applyProjectOrder(projects, []).map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('保存过的顺序在前，未排过的按名称跟在后面，已删除的 id 被忽略', () => {
    expect(applyProjectOrder(projects, ['gone', 'c']).map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('不修改传入的数组', () => {
    const input = projects.slice()
    applyProjectOrder(input, ['b', 'a', 'c'])
    expect(input).toEqual(projects)
  })

  it('实时换位：拖过半个身位就占到相邻项的位置', () => {
    const centers = [10, 30, 50, 70]
    expect(sortDropIndex(centers, 1, 30)).toBe(1)
    expect(sortDropIndex(centers, 1, 38)).toBe(1)
    expect(sortDropIndex(centers, 1, 42)).toBe(3)
    expect(sortDropIndex(centers, 1, 200)).toBe(4)
    expect(sortDropIndex(centers, 2, 18)).toBe(0)
    expect(sortDropIndex(centers, 2, -50)).toBe(0)
    expect(sortDropIndex([], 0, 10)).toBe(0)
    expect(sortDropIndex(centers, -1, 10)).toBe(-1)
  })

  it('让位方向只作用于被拖项目途经的那一段', () => {
    // 从 1 拖到 3 之前（落在原来的 2 后面）：2 上移
    expect([0, 1, 2, 3].map((index) => shiftDirection(index, 1, 3))).toEqual([0, 0, -1, 0])
    // 从 3 拖到 0 之前：0..2 下移
    expect([0, 1, 2, 3].map((index) => shiftDirection(index, 3, 0))).toEqual([1, 1, 1, 0])
    // 落回原位不动
    expect([0, 1, 2].map((index) => shiftDirection(index, 1, 2))).toEqual([0, 0, 0])
  })

  it('向下、向上挪动', () => {
    expect(moveProjectId(['a', 'b', 'c', 'd'], 'a', 3)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveProjectId(['a', 'b', 'c', 'd'], 'a', 4)).toEqual(['b', 'c', 'd', 'a'])
    expect(moveProjectId(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveProjectId(['a', 'b', 'c', 'd'], 'c', 1)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('落回原位或 id 不存在时返回 null', () => {
    expect(moveProjectId(['a', 'b', 'c'], 'b', 1)).toBeNull()
    expect(moveProjectId(['a', 'b', 'c'], 'b', 2)).toBeNull()
    expect(moveProjectId(['a', 'b', 'c'], 'x', 0)).toBeNull()
  })

  it('越界落点夹回范围内', () => {
    expect(moveProjectId(['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a'])
    expect(moveProjectId(['a', 'b', 'c'], 'c', -5)).toEqual(['c', 'a', 'b'])
  })

  it('读写存储，脏数据与存储异常退回空顺序', () => {
    expect(readProjectOrder({ getItem: (key) => key === PROJECT_ORDER_KEY ? '["a",1,"b"]' : null })).toEqual(['a', 'b'])
    expect(readProjectOrder({ getItem: () => '{oops' })).toEqual([])
    expect(readProjectOrder({ getItem: () => '{"a":1}' })).toEqual([])
    expect(readProjectOrder({ getItem: () => { throw new Error('denied') } })).toEqual([])
    const setItem = vi.fn()
    writeProjectOrder({ setItem }, ['a', 'b'])
    expect(setItem).toHaveBeenCalledWith(PROJECT_ORDER_KEY, '["a","b"]')
    expect(() => writeProjectOrder({ setItem: () => { throw new Error('denied') } }, ['a'])).not.toThrow()
  })
})
