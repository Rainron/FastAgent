import { describe, expect, it } from 'vitest'
import { bindingFromKeyboardEvent, bindingFromMouseEvent, bindingLabel, effectiveInAppBinding, matchKeyboardBinding, matchMouseBinding, normalizeBinding } from './shortcuts'

function keyEvent(init: { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }) {
  return {
    key: init.key,
    ctrlKey: init.ctrl ?? false,
    altKey: init.alt ?? false,
    shiftKey: init.shift ?? false,
    metaKey: init.meta ?? false
  }
}

function mouseEvent(button: number) {
  return { button }
}

describe('bindingFromKeyboardEvent', () => {
  it('归一化为固定修饰键顺序', () => {
    expect(bindingFromKeyboardEvent(keyEvent({ key: 'p', ctrl: true, shift: true }))?.value).toBe('Ctrl+Shift+P')
    expect(bindingFromKeyboardEvent(keyEvent({ key: 'P', ctrl: true, shift: true }))?.value).toBe('Ctrl+Shift+P')
  })

  it('单独修饰键返回 null', () => {
    expect(bindingFromKeyboardEvent(keyEvent({ key: 'Control' }))).toBeNull()
    expect(bindingFromKeyboardEvent(keyEvent({ key: 'Shift', shift: true }))).toBeNull()
  })

  it('别名与功能键正常映射', () => {
    expect(bindingFromKeyboardEvent(keyEvent({ key: 'ArrowUp' }))?.value).toBe('Up')
    expect(bindingFromKeyboardEvent(keyEvent({ key: ' ' }))?.value).toBe('Space')
    expect(bindingFromKeyboardEvent(keyEvent({ key: 'F5' }))?.value).toBe('F5')
  })
})

describe('bindingFromMouseEvent', () => {
  it('只映射中键与侧键', () => {
    expect(bindingFromMouseEvent(mouseEvent(1))?.value).toBe('MouseMiddle')
    expect(bindingFromMouseEvent(mouseEvent(3))?.value).toBe('MouseBack')
    expect(bindingFromMouseEvent(mouseEvent(4))?.value).toBe('MouseForward')
    expect(bindingFromMouseEvent(mouseEvent(0))).toBeNull()
    expect(bindingFromMouseEvent(mouseEvent(2))).toBeNull()
  })
})

describe('normalizeBinding', () => {
  it('统一修饰键顺序', () => {
    expect(normalizeBinding({ type: 'key', value: 'Shift+Alt+P' }).value).toBe('Alt+Shift+P')
    expect(normalizeBinding({ type: 'key', value: 'K' }).value).toBe('K')
    expect(normalizeBinding({ type: 'mouse', value: 'MouseBack' }).value).toBe('MouseBack')
  })
})

describe('bindingLabel', () => {
  it('输出可读标签', () => {
    expect(bindingLabel({ type: 'key', value: 'Ctrl+Shift+P' })).toBe('Ctrl + Shift + P')
    expect(bindingLabel({ type: 'mouse', value: 'MouseBack' })).toBe('鼠标后退键')
    expect(bindingLabel(null)).toBe('未绑定')
  })
})

describe('matchKeyboardBinding', () => {
  it('修饰键顺序无关地匹配', () => {
    const binding = { type: 'key' as const, value: 'Ctrl+Shift+P' }
    expect(matchKeyboardBinding(keyEvent({ key: 'p', ctrl: true, shift: true }), binding)).toBe(true)
    expect(matchKeyboardBinding(keyEvent({ key: 'p', ctrl: true }), binding)).toBe(false)
    expect(matchKeyboardBinding(keyEvent({ key: 'o', ctrl: true, shift: true }), binding)).toBe(false)
  })
})

describe('matchMouseBinding', () => {
  it('按鼠标键匹配', () => {
    expect(matchMouseBinding(mouseEvent(3), { type: 'mouse', value: 'MouseBack' })).toBe(true)
    expect(matchMouseBinding(mouseEvent(0), { type: 'mouse', value: 'MouseBack' })).toBe(false)
  })
})

describe('effectiveInAppBinding', () => {
  it('没存过时回落默认绑定', () => {
    expect(effectiveInAppBinding(undefined, 'composerUndo')).toEqual({ type: 'key', value: 'Ctrl+Z' })
    expect(effectiveInAppBinding({ global: {}, inApp: {} }, 'externalEditor')).toEqual({ type: 'key', value: 'Ctrl+G' })
  })

  it('存过就以存储值为准', () => {
    const shortcuts = { global: {}, inApp: { composerRedo: { type: 'key' as const, value: 'Ctrl+Y' } } }
    expect(effectiveInAppBinding(shortcuts, 'composerRedo')).toEqual({ type: 'key', value: 'Ctrl+Y' })
  })

  it('显式清成 null 时不回落默认', () => {
    expect(effectiveInAppBinding({ global: {}, inApp: { composerUndo: null } }, 'composerUndo')).toBeNull()
  })

  it('没有默认值的动作未绑定时返回 null', () => {
    expect(effectiveInAppBinding(undefined, 'hideToTray')).toBeNull()
  })
})
