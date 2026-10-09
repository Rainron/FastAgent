/** 侧栏宽度由用户拖拽决定，存本地：换机器不必同步，但同一台机器上重启要记得住。 */
export const SIDEBAR_WIDTH_KEY = 'fastagent.sidebar-width.v1'
export const DEFAULT_SIDEBAR_WIDTH = 252
export const MIN_SIDEBAR_WIDTH = 200
export const MAX_SIDEBAR_WIDTH = 460

export function clampSidebarWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(Math.max(Math.round(value), MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH)
}

export function readSidebarWidth(storage: Pick<Storage, 'getItem'>): number {
  try {
    const raw = storage.getItem(SIDEBAR_WIDTH_KEY)
    return clampSidebarWidth(raw === null ? undefined : Number(raw))
  } catch {
    // 隐私模式等场景下 localStorage 会抛，宽度不该因此挡住侧栏渲染
    return DEFAULT_SIDEBAR_WIDTH
  }
}

export function writeSidebarWidth(storage: Pick<Storage, 'setItem'>, width: number): void {
  try {
    storage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)))
  } catch {
    // 存不下就只在本次会话里生效
  }
}
