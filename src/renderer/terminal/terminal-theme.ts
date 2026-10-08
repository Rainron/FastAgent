/**
 * xterm 的配色不吃 CSS 变量，只能在挂载时把当前主题的颜色算成一份具体值传进去。
 * 取值从 :root 上真实生效的变量读，主题切换后重新算一次即可保持一致。
 */

export interface TerminalTheme {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

const FALLBACK_DARK: TerminalTheme = { background: '#12141a', foreground: '#d7dae0', cursor: '#d7dae0', selectionBackground: '#3a4152' }
const FALLBACK_LIGHT: TerminalTheme = { background: '#ffffff', foreground: '#24292f', cursor: '#24292f', selectionBackground: '#d7e3f4' }

/** 变量取不到（测试环境、样式还没加载）时按明暗回落，不能让终端画出黑底白字的默认皮肤。 */
export function terminalTheme(read: (name: string) => string, dark: boolean): TerminalTheme {
  const fallback = dark ? FALLBACK_DARK : FALLBACK_LIGHT
  const pick = (name: string, value: string) => read(name).trim() || value
  const foreground = pick('--text-primary', fallback.foreground)
  return {
    background: pick('--surface', fallback.background),
    foreground,
    cursor: foreground,
    selectionBackground: pick('--hover', fallback.selectionBackground)
  }
}

export function readCssVariable(name: string): string {
  if (typeof window === 'undefined') return ''
  return window.getComputedStyle(document.documentElement).getPropertyValue(name)
}
