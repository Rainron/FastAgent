import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useEventCallback } from '../use-event-callback'
import { Overlay } from '../motion'

/**
 * 通用居中弹层：长列表的浏览与批量操作从页面里挪出来，不再靠上下滚动挑内容。
 * 骨架沿用审批 / Git 确认层（approval-*），busy 期间不允许关：
 * 写操作进行到一半界面就没了，用户不知道落没落地。
 */
export function CenterDialog({ title, subtitle, icon, busy = false, open = true, onClose, children, footer }: {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  busy?: boolean
  /** 退场由 Overlay 播，调用方需要留出窗口（见各调用点的 usePresence）。 */
  open?: boolean
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const close = useEventCallback(() => { if (!busy) onClose() })
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => Array.from(overlay.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter((item) => item.getClientRects().length > 0)
    const isTopDialog = () => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      return dialogs[dialogs.length - 1] === overlay
    }
    ;(focusable()[0] ?? overlay).focus()
    const onKeyDown = (event: KeyboardEvent) => {
      // 连接管理里还会打开子弹层，一次 Escape 只能关闭最上层。
      if (!isTopDialog()) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close() }
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0] ?? overlay
      const last = items[items.length - 1] ?? overlay
      if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [close])

  return createPortal(
    <div className="settings-redesign settings-dialog-portal">
      <Overlay open={open} overlayRef={overlayRef} tabIndex={-1} label={title} panelClassName="approval-dialog center-dialog" onBackdropPointerDown={close}>
        <div className="approval-header">
          {icon && <span className="approval-icon">{icon}</span>}
          <div className="approval-heading"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>
          <button type="button" className="icon-button" aria-label="关闭" title="关闭（Esc）" onClick={onClose} disabled={busy}><X size={14} /></button>
        </div>
        <div className="approval-body center-dialog-body">{children}</div>
        {footer && <div className="approval-actions">{footer}</div>}
      </Overlay>
    </div>,
    document.body
  )
}
