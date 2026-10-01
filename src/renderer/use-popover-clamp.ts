import { useLayoutEffect, type RefObject } from 'react'

/** 浮层与窗口边缘至少留这么多：贴边时圆角和投影会被裁掉，看起来就是「界面被遮挡」。 */
export const POPOVER_EDGE_MARGIN = 8

/**
 * 需要沿 x 轴挪多少像素才能把浮层整个拉回视口：正数右移，负数左移，0 表示已经在里面。
 *
 * 右对齐（right: 0）的浮层挂在靠左的触发器上时，整块会往左长到窗口外——开着资源面板、
 * 侧栏收起时尤其明显。浮层比视口还宽时优先保住左边：左边是标题与主按钮，右边通常是数值。
 */
export function popoverShift(rect: { left: number; right: number }, viewportWidth: number, margin = POPOVER_EDGE_MARGIN, minLeft = 0): number {
  if (rect.left < minLeft + margin) return Math.round(minLeft + margin - rect.left)
  if (rect.right > viewportWidth - margin) return -Math.round(rect.right - viewportWidth + margin)
  return 0
}

/**
 * 浮层实际能显示的横向范围：视口，再与最近一个会裁剪横向溢出的祖先取交集。
 * 只夹视口不够——浮层挂在主区里时，主区的 overflow 或侧栏的层叠会把伸到侧栏上方的部分盖掉，
 * 视口测量看起来「没出屏」，肉眼却缺了一块。所以主区（`main`）本身也算一道边界。
 */
export function horizontalBounds(el: HTMLElement): { left: number; right: number } {
  let left = 0
  let right = window.innerWidth
  const main = el.closest('main')
  if (main) {
    const rect = main.getBoundingClientRect()
    left = Math.max(left, rect.left)
    right = Math.min(right, rect.right)
  }
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const overflowX = getComputedStyle(node).overflowX
    if (overflowX === 'visible') continue
    const rect = node.getBoundingClientRect()
    left = Math.max(left, rect.left)
    right = Math.min(right, rect.right)
  }
  return { left, right }
}

/**
 * 向上弹出的 popover（absolute 定位、无翻转逻辑）打开时测量一次，两个方向都夹回视口：
 * 纵向把 max-height 夹到「弹层底边到视口顶」的可用高度，让内容在弹层内滚动而不是出屏；
 * 横向按超出量补一个外边距，把弹层推回窗口内。
 */
export function usePopoverClamp(ref: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!open || !el) return
    const rect = el.getBoundingClientRect()
    // 顶部留 12px 呼吸；下限 160px 防止极端矮窗口把弹层压成一条缝。
    const available = Math.floor(rect.bottom - 12)
    if (rect.top < 12 && available > 160) el.style.maxHeight = `${available}px`
    // 每次重算前先清掉上一次的补偿，否则窗口来回缩放会把偏移累加上去。
    el.style.marginLeft = ''
    el.style.marginRight = ''
    const bounds = horizontalBounds(el)
    const shift = popoverShift(el.getBoundingClientRect(), bounds.right, POPOVER_EDGE_MARGIN, bounds.left)
    if (!shift) return
    // 右对齐时左边距不参与定位（left 是 auto，由 right + width 反推），只能用右边距反向推。
    if (getComputedStyle(el).right !== 'auto') el.style.marginRight = `${-shift}px`
    else el.style.marginLeft = `${shift}px`
  }, [ref, open])
}
