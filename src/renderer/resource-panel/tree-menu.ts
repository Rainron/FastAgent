export interface TreeMenuPosition {
  x: number
  y: number
}

export interface MenuViewport {
  width: number
  height: number
}

/**
 * 右键菜单落点：靠近右 / 下边缘时向内收，避免菜单溢出窗口被裁掉。
 * 视口尺寸参数化传入，逻辑才测得了。
 */
export function menuPosition(point: TreeMenuPosition, size: MenuViewport, viewport: MenuViewport): TreeMenuPosition {
  return {
    x: Math.max(0, Math.min(point.x, viewport.width - size.width)),
    y: Math.max(0, Math.min(point.y, viewport.height - size.height))
  }
}

/** 菜单尺寸估值：宽度按最长项，高度按项数；两棵树的菜单项数不同，各自传。 */
export const MENU_WIDTH = 180

export function menuHeight(itemCount: number): number {
  // 每项 28px + 上下 5px 内边距，分隔线按半项算
  return itemCount * 28 + 10
}
