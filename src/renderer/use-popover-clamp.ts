import { useLayoutEffect, type RefObject } from 'react'

/** 浮层与窗口边缘至少留这么多：贴边时圆角和投影会被裁掉，看起来就是「界面被遮挡」。 */
export const POPOVER_EDGE_MARGIN = 8

/**
 * 需要沿 x 轴挪多少像素才能把浮层整个拉回视口：正数右移，负数左移，0 表示已经在里面。
 *
 * 右对齐（right: 0）的浮层挂在靠左的触发器上时，整块会往左长到窗口外——开着资源面板、
 * 侧栏收起时尤其明显。浮层比视口还宽时优先保住左边：左边是标题与主按钮，右边通常是数值。
 */
export function popoverShift(rect: { left: number; right: number }, viewportWidth: number, margin = POPOVER_EDGE_MARGIN): number {
  if (rect.left < margin) return Math.round(margin - rect.left)
  if (rect.right > viewportWidth - margin) return -Math.round(rect.right - viewportWidth + margin)
  return 0
}

export function popoverPlacement(anchor: { left: number; right: number; top: number; bottom: number }, viewport: { width: number; height: number }, preferred: { width: number; maxHeight: number; upwards: boolean; rightAligned: boolean }) {
  const width = Math.min(preferred.width, Math.max(0, viewport.width - 16))
  const above = Math.max(0, anchor.top - 16)
  const below = Math.max(0, viewport.height - anchor.bottom - 16)
  const up = preferred.upwards ? above >= Math.min(160, below) : !(below >= Math.min(160, above))
  return {
    width,
    maxHeight: Math.min(preferred.maxHeight, up ? above : below),
    left: Math.max(8, Math.min(preferred.rightAligned ? anchor.right - width : anchor.left, viewport.width - width - 8)),
    up
  }
}

/** 使用浏览器顶层，避免输入框动画和滚动内容创建的层级遮住菜单。 */
export function usePopoverClamp(ref: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    if (!open) return
    let frame = 0
    let attempts = 0
    let dispose = () => {}
    const mount = () => {
      const el = ref.current
      if (!el) {
        if (attempts++ < 5) frame = requestAnimationFrame(mount)
        return
      }
      const anchor = el.parentElement
      if (!anchor) return
      const originalStyle = el.style.cssText
      const originalPopover = el.getAttribute('popover')
      const computed = getComputedStyle(el)
      const upwards = computed.bottom !== 'auto'
      const rightAligned = computed.right !== 'auto'
      const preferredWidth = el.offsetWidth
      const heightLimit = parseFloat(computed.maxHeight) || 620
      el.setAttribute('popover', 'manual')
      Object.assign(el.style, { position: 'fixed', inset: 'auto', margin: '0', boxSizing: 'border-box', visibility: 'visible' })
      el.showPopover()
      const place = () => {
        const rect = anchor.getBoundingClientRect()
        const { width, maxHeight, left, up } = popoverPlacement(rect, { width: window.innerWidth, height: window.innerHeight }, { width: preferredWidth, maxHeight: heightLimit, upwards, rightAligned })
        el.style.width = `${width}px`
        el.style.maxHeight = `${maxHeight}px`
        el.style.left = `${left}px`
        el.style.top = `${up ? Math.max(8, rect.top - 8 - el.offsetHeight) : rect.bottom + 8}px`
      }
      place()
      const observer = new ResizeObserver(place)
      observer.observe(el)
      observer.observe(anchor)
      const container = anchor.closest('.composer')
      if (container) observer.observe(container)
      window.addEventListener('resize', place)
      window.addEventListener('scroll', place, true)
      dispose = () => {
        observer.disconnect()
        window.removeEventListener('resize', place)
        window.removeEventListener('scroll', place, true)
        if (el.matches(':popover-open')) el.hidePopover()
        if (originalPopover === null) el.removeAttribute('popover')
        else el.setAttribute('popover', originalPopover)
        el.style.cssText = originalStyle
        el.style.visibility = 'hidden'
      }
    }
    mount()
    return () => { cancelAnimationFrame(frame); dispose() }
  }, [ref, open])
}
