import { useEffect, useRef } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Overlay } from '../motion'

/** 通用确认弹窗：复用审批弹窗的骨架样式，Esc 取消，打开时焦点落到取消按钮。 */
export function ConfirmDialog({ title, lines, confirmLabel, cancelLabel = '取消', danger = false, open = true, onConfirm, onCancel }: {
  title: string
  lines: string[]
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  /** 退场由 Overlay 播，调用方需要留出窗口（见各调用点的 usePresence）。 */
  open?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // 焦点默认给取消：破坏性操作不该被一次回车误触
  useEffect(() => { cancelRef.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return <Overlay open={open} label={title} panelClassName="approval-dialog">
    <div className="approval-header">
      <span className={`approval-icon ${danger ? 'doom_loop' : ''}`}><TriangleAlert size={15} /></span>
      <div className="approval-heading"><strong>{title}</strong></div>
    </div>
    <div className="approval-body">
      {lines.map((line) => <p className="approval-note" key={line}>{line}</p>)}
    </div>
    <div className="approval-actions">
      <button ref={cancelRef} className="quick-secondary" onClick={onCancel}>{cancelLabel}</button>
      <button className={`quick-secondary approval-primary${danger ? ' danger' : ''}`} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </Overlay>
}
