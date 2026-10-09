/**
 * 预览视图的尺寸计算：设备宽度 × 缩放 → iframe 的逻辑尺寸与缩放后的外框尺寸。
 * 纯函数，不碰 DOM；面板尺寸由调用方量好传进来。
 */

export type PreviewDevice = 'responsive' | 'desktop' | 'tablet' | 'mobile'
/** 'fit'：设备宽度超过面板时自动缩小到放得下，不会放大。 */
export type PreviewZoom = number | 'fit'

export interface PreviewDeviceSpec {
  label: string
  /** null 表示随面板宽度（自适应）。 */
  width: number | null
  /** null 表示随面板高度铺满。 */
  height: number | null
}

export const PREVIEW_DEVICES: Record<PreviewDevice, PreviewDeviceSpec> = {
  responsive: { label: '自适应', width: null, height: null },
  desktop: { label: '桌面 1280', width: 1280, height: null },
  tablet: { label: '平板 768', width: 768, height: 1024 },
  mobile: { label: '手机 375', width: 375, height: 812 }
}

export const PREVIEW_DEVICE_ORDER: PreviewDevice[] = ['responsive', 'desktop', 'tablet', 'mobile']

/** 与 Chrome 缩放档位一致，用户对这组数字有肌肉记忆。 */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
export const MIN_ZOOM = ZOOM_STEPS[0]
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]

/** 固定尺寸设备四周留白，看得出设备边界。 */
export const DEVICE_GUTTER = 16

export interface PreviewViewState {
  device: PreviewDevice
  zoom: PreviewZoom
}

export const DEFAULT_PREVIEW_VIEW: PreviewViewState = { device: 'responsive', zoom: 'fit' }

export interface PreviewLayout {
  /** iframe 的逻辑尺寸：页面按这个视口排版。 */
  frameWidth: number
  frameHeight: number
  scale: number
  /** 缩放后在面板里实际占的尺寸，决定滚动区域。 */
  boxWidth: number
  boxHeight: number
  /** 是否有固定设备边框（自适应模式铺满，不画边框）。 */
  framed: boolean
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

/** 当前缩放档位对应的实际倍率。 */
export function resolveScale(viewportWidth: number, device: PreviewDevice, zoom: PreviewZoom): number {
  if (zoom !== 'fit') return clampZoom(zoom)
  const width = PREVIEW_DEVICES[device].width
  if (width === null) return 1
  const available = positive(viewportWidth - DEVICE_GUTTER * 2)
  return clampZoom(Math.min(1, available / width))
}

/**
 * 自适应模式下缩放改变的是「页面看到的视口」：缩到 50% 时页面按两倍面板宽度排版，
 * 相当于在窄面板里看宽屏效果；固定设备则视口不变，只缩放画面。
 */
export function computePreviewLayout(viewport: { width: number; height: number }, device: PreviewDevice, zoom: PreviewZoom): PreviewLayout {
  const width = positive(viewport.width)
  const height = positive(viewport.height)
  const spec = PREVIEW_DEVICES[device]
  const scale = resolveScale(width, device, zoom)
  const framed = spec.width !== null
  const gutter = framed ? DEVICE_GUTTER * 2 : 0
  const frameWidth = Math.round(spec.width ?? width / scale)
  const frameHeight = Math.round(spec.height ?? positive(height - gutter) / scale)
  return {
    frameWidth,
    frameHeight,
    scale,
    boxWidth: Math.round(frameWidth * scale),
    boxHeight: Math.round(frameHeight * scale),
    framed
  }
}

/** 放大 / 缩小一档：从当前实际倍率出发找下一个档位，「适应」态也能接着按。 */
export function stepZoom(currentScale: number, direction: 1 | -1): number {
  const epsilon = 0.001
  if (direction > 0) return ZOOM_STEPS.find((step) => step > currentScale + epsilon) ?? MAX_ZOOM
  return [...ZOOM_STEPS].reverse().find((step) => step < currentScale - epsilon) ?? MIN_ZOOM
}

export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`
}

export function normalizePreviewView(value: unknown): PreviewViewState {
  const item = (value ?? {}) as Partial<PreviewViewState>
  const device = typeof item.device === 'string' && item.device in PREVIEW_DEVICES ? item.device : DEFAULT_PREVIEW_VIEW.device
  const zoom = item.zoom === 'fit' ? 'fit' : typeof item.zoom === 'number' && Number.isFinite(item.zoom) ? clampZoom(item.zoom) : DEFAULT_PREVIEW_VIEW.zoom
  return { device, zoom }
}
