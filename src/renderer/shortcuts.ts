/**
 * 应用内快捷键的匹配与展示逻辑。
 *
 * 绑定值与全局快捷键共用一套格式：键盘为 Electron accelerator 形式，
 * 鼠标为 MouseMiddle / MouseBack / MouseForward。归一化规则两端保持一致，
 * 这样同一个绑定既能在渲染进程匹配，也能交给主进程 globalShortcut 注册。
 */

import type { InAppShortcutAction, ShortcutBinding, ShortcutSettings } from '../shared/types'

/** 未做过任何自定义时的应用内默认绑定；一旦 settings.shortcuts 存在则完全以存储值为准 */
export const DEFAULT_IN_APP_BINDINGS: Partial<Record<InAppShortcutAction, ShortcutBinding>> = {
  commandPalette: { type: 'key', value: 'Ctrl+K' },
  externalEditor: { type: 'key', value: 'Ctrl+G' },
  composerUndo: { type: 'key', value: 'Ctrl+Z' },
  composerRedo: { type: 'key', value: 'Ctrl+Shift+Z' }
}

/**
 * 只在输入框内生效的动作：窗口层引擎必须跳过，否则 Ctrl+Z 这类绑定会在设置页、
 * 搜索框等任何输入框上被 preventDefault，抢掉浏览器自带的撤销。
 */
export const COMPOSER_SCOPED_ACTIONS: InAppShortcutAction[] = ['externalEditor', 'composerUndo', 'composerRedo']

/** 取动作当前生效的应用内绑定：存过就以存储值为准（含显式清除的 null），没存过才回落默认 */
export function effectiveInAppBinding(shortcuts: ShortcutSettings | undefined, action: InAppShortcutAction): ShortcutBinding | null {
  const stored = shortcuts?.inApp?.[action]
  if (stored !== undefined) return stored ?? null
  return DEFAULT_IN_APP_BINDINGS[action] ?? null
}

/** 只依赖用到的字段，测试环境无 DOM 也能构造 */
export interface KeyEventLike {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export interface MouseEventLike {
  button: number
}

/** 修饰键按固定顺序拼接，保证同一个组合键归一化结果唯一 */
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc'
}

const MOUSE_LABELS: Record<string, string> = {
  MouseMiddle: '鼠标中键',
  MouseBack: '鼠标后退键',
  MouseForward: '鼠标前进键'
}

function isModifierKey(key: string): boolean {
  return ['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'Fn', 'FnLock'].includes(key)
}

/** 把 keydown 归一化为绑定值；单独按修饰键、无主键的按键返回 null */
export function bindingFromKeyboardEvent(event: KeyEventLike): ShortcutBinding | null {
  const rawKey = event.key
  if (!rawKey || isModifierKey(rawKey)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')
  const mainKey = KEY_ALIASES[rawKey] ?? (/^F\d{1,2}$/.test(rawKey) ? rawKey : rawKey.length === 1 ? rawKey.toUpperCase() : rawKey)
  parts.push(mainKey)
  return { type: 'key', value: parts.join('+') }
}

/** 鼠标按键 → 绑定值；左键(0)/右键(2) 不参与绑定，避免抢占日常操作 */
export function bindingFromMouseEvent(event: MouseEventLike): ShortcutBinding | null {
  if (event.button === 1) return { type: 'mouse', value: 'MouseMiddle' }
  if (event.button === 3) return { type: 'mouse', value: 'MouseBack' }
  if (event.button === 4) return { type: 'mouse', value: 'MouseForward' }
  return null
}

/** 归一化修饰键顺序；无修饰键时保持原样 */
export function normalizeBinding(binding: ShortcutBinding): ShortcutBinding {
  if (binding.type !== 'key') return binding
  const parts = binding.value.split('+')
  const mainKey = parts[parts.length - 1]
  const modifiers = MODIFIER_ORDER.filter((modifier) => parts.includes(modifier))
  return { type: 'key', value: [...modifiers, mainKey].join('+') }
}

export function bindingLabel(binding: ShortcutBinding | null | undefined): string {
  if (!binding) return '未绑定'
  if (binding.type === 'mouse') return MOUSE_LABELS[binding.value] ?? binding.value
  return binding.value.split('+').join(' + ').replace('Meta', 'Win')
}

export function matchKeyboardBinding(event: KeyEventLike, binding: ShortcutBinding): boolean {
  if (binding.type !== 'key') return false
  const pressed = bindingFromKeyboardEvent(event)
  return Boolean(pressed && normalizeBinding(pressed).value === normalizeBinding(binding).value)
}

export function matchMouseBinding(event: MouseEventLike, binding: ShortcutBinding): boolean {
  if (binding.type !== 'mouse') return false
  const pressed = bindingFromMouseEvent(event)
  return Boolean(pressed && pressed.value === binding.value)
}

/** 是否允许作为主键（录制时用来拒绝纯修饰键之外的无意义按键由调用方判断，这里只提供展示排序） */
export function actionLabels(): Record<string, string> {
  return MOUSE_LABELS
}
