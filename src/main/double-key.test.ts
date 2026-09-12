import { describe, expect, it } from 'vitest'
import { UIHOOK_CTRL_KEYCODE, applyKeyEvent, initialDoubleCtrlState } from './double-key'

/** 模拟一次按键序列，返回是否触发与终态 */
function feed(sequence: Array<{ phase: 'pressed' | 'released'; keycode: number; at: number }>) {
  let state = initialDoubleCtrlState()
  let triggered = false
  for (const event of sequence) {
    const result = applyKeyEvent(state, event)
    state = result.next
    triggered = triggered || result.triggered
  }
  return { state, triggered }
}

const CTRL = UIHOOK_CTRL_KEYCODE
const A = 30 // 任意非 Ctrl 键

describe('applyKeyEvent 连按两次 Ctrl 判定', () => {
  it('两次 Ctrl 间隔小于阈值触发', () => {
    const { triggered } = feed([
      { phase: 'pressed', keycode: CTRL, at: 0 },
      { phase: 'released', keycode: CTRL, at: 40 },
      { phase: 'pressed', keycode: CTRL, at: 200 }
    ])
    expect(triggered).toBe(true)
  })

  it('两次 Ctrl 间隔超过阈值不触发', () => {
    const { triggered } = feed([
      { phase: 'pressed', keycode: CTRL, at: 0 },
      { phase: 'released', keycode: CTRL, at: 40 },
      { phase: 'pressed', keycode: CTRL, at: 600 }
    ])
    expect(triggered).toBe(false)
  })

  it('按住不放的 OS 重复 keydown 不触发也不重置计时', () => {
    const { triggered } = feed([
      { phase: 'pressed', keycode: CTRL, at: 0 },
      // 未 released 的重复 keydown
      { phase: 'pressed', keycode: CTRL, at: 100 },
      { phase: 'pressed', keycode: CTRL, at: 200 },
      { phase: 'released', keycode: CTRL, at: 250 },
      { phase: 'pressed', keycode: CTRL, at: 300 }
    ])
    expect(triggered).toBe(true)
  })

  it('两次 Ctrl 之间按了其他键则打断', () => {
    const { triggered } = feed([
      { phase: 'pressed', keycode: CTRL, at: 0 },
      { phase: 'released', keycode: CTRL, at: 30 },
      { phase: 'pressed', keycode: A, at: 60 },
      { phase: 'released', keycode: A, at: 90 },
      { phase: 'pressed', keycode: CTRL, at: 150 }
    ])
    expect(triggered).toBe(false)
  })

  it('触发后需要重新累计两次按下，三连击只触发一次', () => {
    const { state, triggered } = feed([
      { phase: 'pressed', keycode: CTRL, at: 0 },
      { phase: 'released', keycode: CTRL, at: 30 },
      { phase: 'pressed', keycode: CTRL, at: 150 },
      { phase: 'released', keycode: CTRL, at: 200 },
      { phase: 'pressed', keycode: CTRL, at: 260 }
    ])
    expect(triggered).toBe(true)
    // 触发时清空计时，第三次按下不应再触发
    expect(state.lastPressAt).toBe(260)
  })

  it('释放其他键不影响判定，只统计按下阶段', () => {
    const { triggered } = feed([
      { phase: 'pressed', keycode: CTRL, at: 0 },
      { phase: 'released', keycode: CTRL, at: 30 },
      { phase: 'pressed', keycode: A, at: 60 },
      { phase: 'released', keycode: CTRL, at: 80 },
      { phase: 'pressed', keycode: CTRL, at: 120 }
    ])
    expect(triggered).toBe(false)
  })
})
