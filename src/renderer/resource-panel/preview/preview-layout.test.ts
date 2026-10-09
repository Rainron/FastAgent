import { describe, expect, it } from 'vitest'
import { computePreviewLayout, DEVICE_GUTTER, formatZoom, MAX_ZOOM, MIN_ZOOM, normalizePreviewView, resolveScale, stepZoom } from './preview-layout'

describe('computePreviewLayout', () => {
  it('自适应 100%：iframe 与面板等大，不画设备边框', () => {
    expect(computePreviewLayout({ width: 480, height: 700 }, 'responsive', 1)).toEqual({ frameWidth: 480, frameHeight: 700, scale: 1, boxWidth: 480, boxHeight: 700, framed: false })
  })

  it('自适应缩到 50%：页面按两倍面板宽度排版，外框仍铺满面板', () => {
    const layout = computePreviewLayout({ width: 480, height: 700 }, 'responsive', 0.5)
    expect(layout.frameWidth).toBe(960)
    expect(layout.frameHeight).toBe(1400)
    expect(layout.boxWidth).toBe(480)
    expect(layout.boxHeight).toBe(700)
  })

  it('自适应下「适应」等同 100%', () => {
    expect(computePreviewLayout({ width: 480, height: 700 }, 'responsive', 'fit').scale).toBe(1)
  })

  it('桌面宽度在窄面板里「适应」会缩小到放得下', () => {
    const layout = computePreviewLayout({ width: 480, height: 700 }, 'desktop', 'fit')
    expect(layout.frameWidth).toBe(1280)
    expect(layout.scale).toBeCloseTo((480 - DEVICE_GUTTER * 2) / 1280)
    expect(layout.boxWidth).toBeLessThanOrEqual(480 - DEVICE_GUTTER * 2)
    expect(layout.framed).toBe(true)
  })

  it('面板足够宽时「适应」不放大', () => {
    expect(computePreviewLayout({ width: 1600, height: 900 }, 'mobile', 'fit').scale).toBe(1)
  })

  it('固定尺寸设备保持设备视口，手动缩放只缩画面', () => {
    const layout = computePreviewLayout({ width: 480, height: 700 }, 'mobile', 0.5)
    expect(layout).toMatchObject({ frameWidth: 375, frameHeight: 812, scale: 0.5, boxWidth: 188, boxHeight: 406 })
  })

  it('面板尺寸异常（0 或 NaN）不产出 NaN', () => {
    const layout = computePreviewLayout({ width: 0, height: Number.NaN }, 'responsive', 1)
    expect(Number.isFinite(layout.frameWidth)).toBe(true)
    expect(Number.isFinite(layout.frameHeight)).toBe(true)
  })

  it('缩放倍率被夹在档位范围内', () => {
    expect(resolveScale(480, 'responsive', 9)).toBe(MAX_ZOOM)
    expect(resolveScale(480, 'responsive', 0.01)).toBe(MIN_ZOOM)
    expect(resolveScale(10, 'desktop', 'fit')).toBe(MIN_ZOOM)
  })
})

describe('stepZoom', () => {
  it('按档位放大缩小', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
  })

  it('从非档位的「适应」倍率出发找相邻档', () => {
    expect(stepZoom(0.3437, 1)).toBe(0.5)
    expect(stepZoom(0.3437, -1)).toBe(0.33)
  })

  it('到头后停在边界', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })
})

describe('normalizePreviewView', () => {
  it('损坏或缺失回落默认', () => {
    expect(normalizePreviewView(null)).toEqual({ device: 'responsive', zoom: 'fit' })
    expect(normalizePreviewView({ device: 'watch', zoom: 'big' })).toEqual({ device: 'responsive', zoom: 'fit' })
  })

  it('保留合法值并夹住缩放', () => {
    expect(normalizePreviewView({ device: 'tablet', zoom: 5 })).toEqual({ device: 'tablet', zoom: MAX_ZOOM })
  })

  it('百分比格式', () => {
    expect(formatZoom(0.6667)).toBe('67%')
  })
})
