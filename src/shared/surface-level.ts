import type { SurfaceLevel } from './types'

/**
 * 三档底色对应的 canvas 值。主进程建窗要用它定 backgroundColor，
 * 必须与 styles.css 里同名档位的 --canvas 保持一致，否则首帧会闪一下别的底色。
 */
export const CANVAS_COLORS: Record<'light' | 'dark', Record<SurfaceLevel, string>> = {
  light: { dim: '#F4F2ED', standard: '#FAF8F3', bright: '#FFFDF8' },
  dark: { dim: '#161513', standard: '#201F1D', bright: '#2A2927' }
}

export function canvasColor(theme: 'light' | 'dark', level: SurfaceLevel | undefined): string {
  return CANVAS_COLORS[theme][level ?? 'standard'] ?? CANVAS_COLORS[theme].standard
}
