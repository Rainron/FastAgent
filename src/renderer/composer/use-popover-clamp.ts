import { useLayoutEffect, type RefObject } from 'react'

/**
 * 向上弹出的 popover（absolute 定位、无翻转逻辑）在窗口较矮或输入框被拉高时，
 * 顶部会超出视口被裁掉且无法滚回。打开时测量一次，把 max-height 夹到
 * 「弹层底边到视口顶」的可用高度，让内容在弹层内部滚动而不是出屏。
 */
export function usePopoverClamp(ref: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!open || !el) return
    const rect = el.getBoundingClientRect()
    // 顶部留 12px 呼吸；下限 160px 防止极端矮窗口把弹层压成一条缝。
    const available = Math.floor(rect.bottom - 12)
    if (rect.top < 12 && available > 160) el.style.maxHeight = `${available}px`
  }, [ref, open])
}
