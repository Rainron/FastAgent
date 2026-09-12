/**
 * 全局快捷键（除连按两次 Ctrl 外）的注册与鼠标钩子。
 *
 * 键盘绑定走 Electron globalShortcut（会独占系统热键，冲突时注册失败）；
 * 鼠标侧键/中键走 uiohook 低级钩子（只监听不拦截），左键/右键一律忽略，
 * 避免把普通点击变成系统级触发。逻辑拆成纯函数便于单测，副作用注入依赖。
 */

import type { GlobalShortcutAction, ShortcutSettings } from '../shared/types'

export interface GlobalShortcutHandlers {
  showMainWindow: () => void
  quickChat: () => void
}

/** 与 Electron globalShortcut 同形的最小接口，便于单测注入 */
export interface GlobalShortcutRegistrar {
  register(accelerator: string, handler: () => void): boolean
  unregister(accelerator: string): void
}

const ACTION_HANDLERS: Record<GlobalShortcutAction, keyof GlobalShortcutHandlers> = {
  showMainWindow: 'showMainWindow',
  quickChat: 'quickChat'
}

/** 提取某组绑定里的键盘绑定；鼠标绑定不归 globalShortcut 管 */
export function keyAcceleratorMap(shortcuts: ShortcutSettings | undefined): Partial<Record<GlobalShortcutAction, string>> {
  const map: Partial<Record<GlobalShortcutAction, string>> = {}
  for (const action of Object.keys(ACTION_HANDLERS) as GlobalShortcutAction[]) {
    const binding = shortcuts?.global?.[action]
    if (binding && binding.type === 'key' && binding.value) map[action] = binding.value
  }
  return map
}

export interface GlobalShortcutApplyResult {
  registered: string[]
  /** globalShortcut.register 返回 false 的加速键，通常是被其他应用占用 */
  failed: string[]
}

/** 对比新旧绑定增量注册/注销；同一加速键换绑动作时会先注销再注册 */
export function applyGlobalShortcuts(
  registrar: GlobalShortcutRegistrar,
  next: ShortcutSettings | undefined,
  previous: ShortcutSettings | undefined,
  handlers: GlobalShortcutHandlers
): GlobalShortcutApplyResult {
  const nextMap = keyAcceleratorMap(next)
  const previousMap = keyAcceleratorMap(previous)
  const result: GlobalShortcutApplyResult = { registered: [], failed: [] }
  for (const [action, accelerator] of Object.entries(previousMap) as Array<[GlobalShortcutAction, string]>) {
    if (nextMap[action] !== accelerator) registrar.unregister(accelerator)
  }
  for (const [action, accelerator] of Object.entries(nextMap) as Array<[GlobalShortcutAction, string]>) {
    const handler = handlers[ACTION_HANDLERS[action]]
    if (registrar.register(accelerator, handler)) result.registered.push(accelerator)
    else result.failed.push(accelerator)
  }
  return result
}

/** 注销全部全局键盘快捷键；退出应用或关闭功能时调用 */
export function unregisterAllGlobalShortcuts(registrar: GlobalShortcutRegistrar, shortcuts: ShortcutSettings | undefined): void {
  for (const accelerator of Object.values(keyAcceleratorMap(shortcuts)) as string[]) {
    if (accelerator) registrar.unregister(accelerator)
  }
}

/** uiohook button → 绑定值；左键(1)/右键(3) 永远返回 null，防止系统级误触 */
export function mouseButtonToValue(button: number): 'MouseMiddle' | 'MouseBack' | 'MouseForward' | null {
  if (button === 2) return 'MouseMiddle'
  if (button === 4) return 'MouseBack'
  if (button === 5) return 'MouseForward'
  return null
}

export interface GlobalMouseHook {
  stop: () => void
}

/** 与 uiohook-napi 实例同形的最小接口，便于单测注入 */
export interface MouseHookSource {
  on(event: 'mousedown', listener: (event: { button: number }) => void): unknown
  start(): unknown
  stop(): unknown
}

/** 启动全局鼠标快捷键监听；loadHook 返回已启动的钩子实例（线程生命周期由调用方经 hook-lifecycle 管理），加载失败时静默降级 */
export function startGlobalMouseShortcuts(loadHook: () => Promise<MouseHookSource>, shortcuts: ShortcutSettings | undefined, handlers: GlobalShortcutHandlers): Promise<GlobalMouseHook> {
  return loadHook().then((hook) => {
    let enabled = true
    const mapping: Record<string, GlobalShortcutAction> = {}
    for (const action of Object.keys(ACTION_HANDLERS) as GlobalShortcutAction[]) {
      const binding = shortcuts?.global?.[action]
      if (binding && binding.type === 'mouse' && binding.value) mapping[binding.value] = action
    }
    hook.on('mousedown', (event) => {
      if (!enabled) return
      const value = mouseButtonToValue(event.button)
      if (!value) return
      const action = mapping[value]
      if (action) handlers[ACTION_HANDLERS[action]]()
    })
    // 钩子线程由 hook-lifecycle 引用计数管理，这里只停用本模块的监听
    return {
      stop: () => { enabled = false }
    }
  })
}

/** 是否存在需要鼠标钩子的全局绑定 */
export function hasGlobalMouseBinding(shortcuts: ShortcutSettings | undefined): boolean {
  return Object.keys(ACTION_HANDLERS).some((action) => {
    const binding = shortcuts?.global?.[action as GlobalShortcutAction]
    return Boolean(binding && binding.type === 'mouse' && binding.value)
  })
}
