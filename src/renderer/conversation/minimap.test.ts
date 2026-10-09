import { describe, expect, it } from 'vitest'
import { minimapBars, minimapRatioFromPointer, minimapScrollTarget, minimapViewport, type MinimapSegment } from './minimap'

const segment = (id: string, top: number, height: number): MinimapSegment => ({ id, top, height, role: 'assistant', kind: 'idle', label: id, blocks: [] })

describe('minimapBars', () => {
  it('按 scrollHeight 归一化成比例，其余字段原样透传', () => {
    const bars = minimapBars([segment('a', 0, 500), segment('b', 500, 1500)], 2000)
    expect(bars).toEqual([
      { id: 'a', role: 'assistant', kind: 'idle', label: 'a', blocks: [], top: 0, height: 0.25 },
      { id: 'b', role: 'assistant', kind: 'idle', label: 'b', blocks: [], top: 0.25, height: 0.75 }
    ])
  })

  it('极短回合抬到最小高度，且不越出底边', () => {
    const bars = minimapBars([segment('tiny', 9999, 1)], 10000)
    expect(bars[0].height).toBeGreaterThan(0)
    expect(bars[0].top + bars[0].height).toBeLessThanOrEqual(1)
  })

  it('内容未渲染时返回空数组', () => {
    expect(minimapBars([segment('a', 0, 10)], 0)).toEqual([])
    expect(minimapBars([segment('a', 0, 10)], Number.NaN)).toEqual([])
  })
})

describe('minimapViewport', () => {
  it('按可视比例给出指示块', () => {
    expect(minimapViewport({ scrollTop: 500, scrollHeight: 2000, clientHeight: 500 })).toEqual({ top: 0.25, height: 0.25 })
  })

  it('内容不足一屏时占满', () => {
    expect(minimapViewport({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 })).toEqual({ top: 0, height: 1 })
  })

  it('滚到底时指示块贴着底边而不是溢出', () => {
    const viewport = minimapViewport({ scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 })
    expect(viewport.top + viewport.height).toBeCloseTo(1)
  })
})

describe('minimapScrollTarget', () => {
  const metrics = { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 }

  it('把点中的位置放到视口中间', () => {
    expect(minimapScrollTarget(0.5, metrics)).toBe(750)
  })

  it('两端夹紧在可滚动范围内', () => {
    expect(minimapScrollTarget(0, metrics)).toBe(0)
    expect(minimapScrollTarget(1, metrics)).toBe(1500)
  })

  it('内容不足一屏时恒为 0', () => {
    expect(minimapScrollTarget(0.8, { scrollTop: 0, scrollHeight: 300, clientHeight: 400 })).toBe(0)
  })
})

describe('minimapRatioFromPointer', () => {
  const track = { top: 100, height: 400 }

  it('轨道内按比例换算', () => {
    expect(minimapRatioFromPointer(300, track)).toBe(0.5)
  })

  it('拖出轨道时贴边，不会跳到另一端', () => {
    expect(minimapRatioFromPointer(-50, track)).toBe(0)
    expect(minimapRatioFromPointer(9999, track)).toBe(1)
  })

  it('轨道尚未布局时返回 0', () => {
    expect(minimapRatioFromPointer(300, { top: 0, height: 0 })).toBe(0)
  })
})
