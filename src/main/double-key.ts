/**
 * 连按两次 Ctrl 的全局快捷键检测。
 *
 * 不能用 Electron globalShortcut 注册裸 Ctrl：全局热键会独占按键，
 * 会吞掉系统里所有 Ctrl 组合键。低级键盘钩子只监听不拦截，不影响其他应用。
 * 判定逻辑抽成纯函数便于单测，钩子只在 start 时加载原生模块。
 */

import { acquireUiohook, releaseUiohook } from './hook-lifecycle'

/** 两次 Ctrl keydown 的最大间隔；超过视为两次独立按下 */
export const DOUBLE_CTRL_INTERVAL_MS = 500

/** Ctrl 在 uiohook 中的 keycode（Left/Right 共用 29） */
export const UIHOOK_CTRL_KEYCODE = 29

export interface DoubleCtrlState {
  /** 上一次 Ctrl keydown 的时间戳；null 表示窗口外 */
  lastPressAt: number | null
  /** 上次 Ctrl 按下后是否出现过其他按键（出现则打断连按判定） */
  otherKeySincePress: boolean
  /** Ctrl 当前是否按住；用于过滤按住不放产生的 OS 重复 keydown */
  ctrlHeld: boolean
}

export type KeyPhase = 'pressed' | 'released'

export interface HookKeyEvent {
  phase: KeyPhase
  keycode: number
  /** 事件时间戳（毫秒） */
  at: number
}

export interface DoubleCtrlResult {
  next: DoubleCtrlState
  triggered: boolean
}

export function initialDoubleCtrlState(): DoubleCtrlState {
  return { lastPressAt: null, otherKeySincePress: false, ctrlHeld: false }
}

export function applyKeyEvent(state: DoubleCtrlState, event: HookKeyEvent): DoubleCtrlResult {
  const isCtrl = event.keycode === UIHOOK_CTRL_KEYCODE
  if (!isCtrl) {
    if (event.phase === 'pressed') return { next: { ...state, otherKeySincePress: true }, triggered: false }
    return { next: state, triggered: false }
  }
  if (event.phase === 'released') {
    // 重复 keydown 之间不会插入 released；这里只负责清按住标记
    return { next: { ...state, ctrlHeld: false }, triggered: false }
  }
  if (state.ctrlHeld) return { next: state, triggered: false }
  const withinInterval = state.lastPressAt !== null && !state.otherKeySincePress && event.at - state.lastPressAt < DOUBLE_CTRL_INTERVAL_MS
  // 触发后清空计时：三连击不应连续触发两次
  return {
    next: { lastPressAt: withinInterval ? null : event.at, otherKeySincePress: false, ctrlHeld: true },
    triggered: withinInterval
  }
}

export interface DoubleCtrlHook {
  stop: () => void
}

/** 启动全局键盘钩子；原生模块加载失败时静默降级为不可用，不影响主应用。 */
export async function startDoubleCtrlHook(onTrigger: () => void): Promise<DoubleCtrlHook> {
  let enabled = true
  try {
    const uIOhook = await acquireUiohook()
    let state = initialDoubleCtrlState()
    const handle = (phase: KeyPhase) => (event: { keycode: number }) => {
      if (!enabled) return
      const result = applyKeyEvent(state, { phase, keycode: event.keycode, at: Date.now() })
      state = result.next
      if (result.triggered) onTrigger()
    }
    // 用类型化的 'keydown'/'keyup' 事件而非 EventType 常量，两者等价但前者有类型提示
    uIOhook.on('keydown', handle('pressed'))
    uIOhook.on('keyup', handle('released'))
    return {
      stop: () => {
        enabled = false
        releaseUiohook()
      }
    }
  } catch (error) {
    console.error('[double-key] 键盘钩子不可用，快速对话快捷键已禁用:', error)
    return { stop: () => undefined }
  }
}
