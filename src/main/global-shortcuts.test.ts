import { describe, expect, it, vi } from 'vitest'
import type { ShortcutSettings } from '../shared/types'
import {
  applyGlobalShortcuts,
  hasGlobalMouseBinding,
  keyAcceleratorMap,
  migrateShortcutSettings,
  mouseButtonToValue,
  startGlobalMouseShortcuts,
  unregisterAllGlobalShortcuts,
  type GlobalShortcutRegistrar,
  type MouseHookSource
} from './global-shortcuts'

const key = (value: string) => ({ type: 'key' as const, value })
const mouse = (value: 'MouseMiddle' | 'MouseBack' | 'MouseForward') => ({ type: 'mouse' as const, value })

function createRegistrar() {
  const registered = new Map<string, () => void>()
  const registrar: GlobalShortcutRegistrar = {
    register: (accelerator, handler) => {
      // 模拟加速键 Ctrl+G 被系统占用的场景
      if (accelerator === 'Ctrl+G') return false
      registered.set(accelerator, handler)
      return true
    },
    unregister: (accelerator) => { registered.delete(accelerator) }
  }
  return { registrar, registered }
}

describe('keyAcceleratorMap', () => {
  it('只保留键盘绑定', () => {
    const shortcuts: ShortcutSettings = {
      global: { toggleMainWindow: key('Ctrl+Alt+M'), quickChat: mouse('MouseBack') },
      inApp: {}
    }
    expect(keyAcceleratorMap(shortcuts)).toEqual({ toggleMainWindow: 'Ctrl+Alt+M' })
  })

  it('未设置时返回空映射', () => {
    expect(keyAcceleratorMap(undefined)).toEqual({})
  })
})

describe('applyGlobalShortcuts', () => {
  const handlers = { toggleMainWindow: vi.fn(), quickChat: vi.fn() }

  it('注册新绑定并触发对应 handler', () => {
    const { registrar, registered } = createRegistrar()
    const next: ShortcutSettings = { global: { toggleMainWindow: key('Ctrl+Alt+M'), quickChat: key('Alt+Q') }, inApp: {} }
    const result = applyGlobalShortcuts(registrar, next, undefined, handlers)
    expect(result.registered.sort()).toEqual(['Alt+Q', 'Ctrl+Alt+M'])
    expect(result.failed).toEqual([])
    registered.get('Alt+Q')!()
    expect(handlers.quickChat).toHaveBeenCalled()
    registered.get('Ctrl+Alt+M')!()
    expect(handlers.toggleMainWindow).toHaveBeenCalled()
  })

  it('换绑时注销旧加速键', () => {
    const { registrar, registered } = createRegistrar()
    const before: ShortcutSettings = { global: { toggleMainWindow: key('Ctrl+Alt+M') }, inApp: {} }
    const after: ShortcutSettings = { global: { toggleMainWindow: key('Ctrl+Shift+M') }, inApp: {} }
    applyGlobalShortcuts(registrar, before, undefined, handlers)
    applyGlobalShortcuts(registrar, after, before, handlers)
    expect(registered.has('Ctrl+Alt+M')).toBe(false)
    expect(registered.has('Ctrl+Shift+M')).toBe(true)
  })

  it('清除绑定时注销对应加速键', () => {
    const { registrar, registered } = createRegistrar()
    const before: ShortcutSettings = { global: { quickChat: key('Alt+Q') }, inApp: {} }
    const after: ShortcutSettings = { global: { quickChat: null }, inApp: {} }
    applyGlobalShortcuts(registrar, before, undefined, handlers)
    applyGlobalShortcuts(registrar, after, before, handlers)
    expect(registered.size).toBe(0)
  })

  it('注册失败时归入 failed 列表', () => {
    const { registrar } = createRegistrar()
    const next: ShortcutSettings = { global: { toggleMainWindow: key('Ctrl+G') }, inApp: {} }
    const result = applyGlobalShortcuts(registrar, next, undefined, handlers)
    expect(result.failed).toEqual(['Ctrl+G'])
    expect(result.registered).toEqual([])
  })
})

describe('unregisterAllGlobalShortcuts', () => {
  it('注销全部键盘绑定', () => {
    const { registrar, registered } = createRegistrar()
    const shortcuts: ShortcutSettings = { global: { toggleMainWindow: key('Ctrl+Alt+M'), quickChat: mouse('MouseBack') }, inApp: {} }
    applyGlobalShortcuts(registrar, shortcuts, undefined, { toggleMainWindow: vi.fn(), quickChat: vi.fn() })
    unregisterAllGlobalShortcuts(registrar, shortcuts)
    expect(registered.size).toBe(0)
  })
})

describe('migrateShortcutSettings', () => {
  it('把旧的全局「显示主窗口」绑定迁到 toggleMainWindow', () => {
    const migrated = migrateShortcutSettings({ global: { showMainWindow: key('Ctrl+Alt+M') }, inApp: {} } as unknown as ShortcutSettings)
    expect(migrated).toEqual({ global: { toggleMainWindow: key('Ctrl+Alt+M') }, inApp: {} })
  })

  it('只有应用内「收进托盘」绑定时用它兜底', () => {
    const migrated = migrateShortcutSettings({ global: {}, inApp: { hideToTray: key('Ctrl+Alt+H'), openSettings: key('Ctrl+,') } } as unknown as ShortcutSettings)
    expect(migrated).toEqual({ global: { toggleMainWindow: key('Ctrl+Alt+H') }, inApp: { openSettings: key('Ctrl+,') } })
  })

  it('两个旧绑定都有时以全局的为准，且旧键一律清掉', () => {
    const migrated = migrateShortcutSettings({ global: { showMainWindow: key('Ctrl+Alt+M') }, inApp: { hideToTray: key('Ctrl+Alt+H') } } as unknown as ShortcutSettings)
    expect(migrated).toEqual({ global: { toggleMainWindow: key('Ctrl+Alt+M') }, inApp: {} })
  })

  it('旧绑定被显式清除过时迁移成同样的已清除状态，不回落到另一个', () => {
    const migrated = migrateShortcutSettings({ global: { showMainWindow: null }, inApp: { hideToTray: key('Ctrl+Alt+H') } } as unknown as ShortcutSettings)
    expect(migrated).toEqual({ global: { toggleMainWindow: null }, inApp: {} })
  })

  it('已有新绑定时不被旧绑定覆盖', () => {
    const migrated = migrateShortcutSettings({ global: { toggleMainWindow: key('Alt+W'), showMainWindow: key('Ctrl+Alt+M') }, inApp: {} } as unknown as ShortcutSettings)
    expect(migrated).toEqual({ global: { toggleMainWindow: key('Alt+W') }, inApp: {} })
  })

  it('没有旧键时原样返回，不产生新对象', () => {
    const shortcuts: ShortcutSettings = { global: { quickChat: key('Alt+Q') }, inApp: {} }
    expect(migrateShortcutSettings(shortcuts)).toBe(shortcuts)
    expect(migrateShortcutSettings(undefined)).toBeUndefined()
  })
})

describe('mouseButtonToValue', () => {
  it('只映射中键与侧键', () => {
    expect(mouseButtonToValue(2)).toBe('MouseMiddle')
    expect(mouseButtonToValue(4)).toBe('MouseBack')
    expect(mouseButtonToValue(5)).toBe('MouseForward')
    expect(mouseButtonToValue(0)).toBeNull()
    expect(mouseButtonToValue(1)).toBeNull()
    expect(mouseButtonToValue(3)).toBeNull()
  })
})

describe('startGlobalMouseShortcuts', () => {
  function createHookSource() {
    const listeners: Array<(event: { button: number }) => void> = []
    const source: MouseHookSource = {
      on: (_event, listener) => { listeners.push(listener) },
      start: () => undefined,
      stop: () => undefined
    }
    return { listeners, source }
  }

  it('按下绑定的鼠标键时触发对应动作', async () => {
    const { listeners, source } = createHookSource()
    const handlers = { toggleMainWindow: vi.fn(), quickChat: vi.fn() }
    const shortcuts: ShortcutSettings = { global: { toggleMainWindow: mouse('MouseBack'), quickChat: key('Alt+Q') }, inApp: {} }
    const hook = await startGlobalMouseShortcuts(async () => source, shortcuts, handlers)
    listeners[0]({ button: 4 })
    expect(handlers.toggleMainWindow).toHaveBeenCalledTimes(1)
    expect(handlers.quickChat).not.toHaveBeenCalled()
    listeners[0]({ button: 1 })
    expect(handlers.toggleMainWindow).toHaveBeenCalledTimes(1)
    hook.stop()
  })

  it('stop 后不再触发', async () => {
    const { listeners, source } = createHookSource()
    const handlers = { toggleMainWindow: vi.fn(), quickChat: vi.fn() }
    const shortcuts: ShortcutSettings = { global: { toggleMainWindow: mouse('MouseForward') }, inApp: {} }
    const hook = await startGlobalMouseShortcuts(async () => source, shortcuts, handlers)
    hook.stop()
    listeners[0]({ button: 5 })
    expect(handlers.toggleMainWindow).not.toHaveBeenCalled()
  })

  it('钩子启动失败时静默降级', async () => {
    const handlers = { toggleMainWindow: vi.fn(), quickChat: vi.fn() }
    const hook = await startGlobalMouseShortcuts(async () => { throw new Error('no native module') }, undefined, handlers).catch(() => null)
    expect(hook).toBeNull()
  })
})

describe('hasGlobalMouseBinding', () => {
  it('识别鼠标绑定', () => {
    expect(hasGlobalMouseBinding({ global: { quickChat: mouse('MouseMiddle') }, inApp: {} })).toBe(true)
    expect(hasGlobalMouseBinding({ global: { quickChat: key('Alt+Q') }, inApp: {} })).toBe(false)
    expect(hasGlobalMouseBinding(undefined)).toBe(false)
  })
})
