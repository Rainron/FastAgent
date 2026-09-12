import { describe, expect, it } from 'vitest'
import { clampMenuPosition } from './message-context-menu'

describe('clampMenuPosition', () => {
  it('视口内直接贴光标', () => {
    expect(clampMenuPosition(100, 100, 1920, 1080)).toEqual({ x: 100, y: 100 })
  })

  it('右下越界时夹回视口', () => {
    const pos = clampMenuPosition(1900, 1000, 1920, 1080, 180, 240)
    expect(pos.x).toBe(1920 - 180)
    expect(pos.y).toBe(1080 - 240)
  })

  it('负坐标夹回原点', () => {
    expect(clampMenuPosition(-10, -5, 1920, 1080)).toEqual({ x: 0, y: 0 })
  })

  it('视口比菜单还小时停在场原点', () => {
    expect(clampMenuPosition(50, 50, 100, 100, 200, 200)).toEqual({ x: 0, y: 0 })
  })
})
