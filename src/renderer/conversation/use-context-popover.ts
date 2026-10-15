import { useLayoutEffect, type RefObject } from 'react'
import { contextPopoverPosition } from './context-popover-position'

export function useContextPopover(open: boolean, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, close: () => void) {
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return
    const trigger = anchor.current
    const popover = panel.current
    const place = () => {
      const position = contextPopoverPosition(trigger.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, popover.scrollHeight + 2)
      Object.assign(popover.style, { position: 'fixed', right: 'auto', bottom: 'auto', left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px`, maxHeight: `${position.maxHeight}px`, zIndex: '90' })
    }
    const dismiss = (event: PointerEvent) => {
      if (!trigger.contains(event.target as Node) && !popover.contains(event.target as Node)) close()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(trigger)
    observer.observe(popover)
    const container = trigger.closest('.composer') ?? trigger.parentElement
    if (container) observer.observe(container)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open, anchor, panel, close])
}
