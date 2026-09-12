import { useEffect } from 'react'

/** 点击浮层外部或按 Esc 关闭；独立模块避免弹层组件反向依赖 App 形成循环引用。 */
export function useDismiss(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown) }
  }, [open, onClose, ref])
}
