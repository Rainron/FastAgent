/**
 * 侧栏列表项管理菜单的定位。
 *
 * 菜单挂到 body 用 position: fixed，坐标在这里算：留在列表里会被 `.sidebar-lists`
 * 的 overflow 裁掉，z-index 对裁剪无效。
 */

export interface Rect {
  top: number
  bottom: number
  right: number
}

export interface Size {
  width: number
  height: number
}

/** 菜单与触发按钮的纵向间距，与原先 top: calc(100% - 2px) 保持一致 */
const OFFSET = 2

/** 贴边留白，避免菜单压在窗口边缘上 */
const MARGIN = 8

/**
 * 右对齐触发按钮向下展开；下方装不下就翻到上方。
 * 两边都装不下时优先保住顶部可见，否则菜单头部被切掉就完全没法用了。
 */
export function anchorMenuPosition(trigger: Rect, menu: Size, viewport: Size): { left: number; top: number } {
  const left = Math.min(Math.max(trigger.right - menu.width, MARGIN), Math.max(viewport.width - menu.width - MARGIN, MARGIN))
  const below = trigger.bottom - OFFSET
  const above = trigger.top - menu.height + OFFSET
  const fitsBelow = below + menu.height <= viewport.height - MARGIN
  const top = fitsBelow ? below : Math.max(above, MARGIN)
  return { left, top }
}
