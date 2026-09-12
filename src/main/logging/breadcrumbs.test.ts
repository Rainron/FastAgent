import { describe, expect, it } from 'vitest'
import { createBreadcrumbTrail } from './breadcrumbs'

/** 固定时钟：断言只关心顺序与内容，不关心真实时间。 */
function fixedClock() {
  let tick = 0
  return () => new Date(Date.UTC(2026, 8, 2, 0, 0, tick++))
}

describe('createBreadcrumbTrail', () => {
  it('未写满时按写入顺序返回', () => {
    const trail = createBreadcrumbTrail(5, fixedClock())
    trail.add('ipc', 'a')
    trail.add('run', 'b')
    expect(trail.snapshot().map((item) => item.message)).toEqual(['a', 'b'])
  })

  it('超出容量后只保留最新的若干条，且仍是时间正序', () => {
    const trail = createBreadcrumbTrail(3, fixedClock())
    for (const message of ['a', 'b', 'c', 'd', 'e']) trail.add('ipc', message)
    expect(trail.snapshot().map((item) => item.message)).toEqual(['c', 'd', 'e'])
  })

  it('恰好写满一轮时顺序不乱', () => {
    const trail = createBreadcrumbTrail(3, fixedClock())
    for (const message of ['a', 'b', 'c']) trail.add('ipc', message)
    expect(trail.snapshot().map((item) => item.message)).toEqual(['a', 'b', 'c'])
  })

  it('绕多圈后仍只保留最新一轮', () => {
    const trail = createBreadcrumbTrail(2, fixedClock())
    for (const message of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) trail.add('ipc', message)
    expect(trail.snapshot().map((item) => item.message)).toEqual(['f', 'g'])
  })

  it('记录 scope 与时间戳', () => {
    const trail = createBreadcrumbTrail(2, fixedClock())
    trail.add('auth', 'ready')
    expect(trail.snapshot()[0]).toEqual({ at: '2026-09-02T00:00:00.000Z', scope: 'auth', message: 'ready' })
  })

  it('容量为 0 时不记录也不抛错', () => {
    const trail = createBreadcrumbTrail(0, fixedClock())
    trail.add('ipc', 'a')
    expect(trail.snapshot()).toEqual([])
  })
})
