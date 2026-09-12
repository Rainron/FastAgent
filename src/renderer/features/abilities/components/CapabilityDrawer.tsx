import { useEffect } from 'react'
import { X } from 'lucide-react'

/** 右侧 Drawer：创建/编辑不在主页面驻留，点开临时覆盖在内容上方。 */
export function CapabilityDrawer({ title, subtitle, onClose, children, footer }: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return <div className="cap-drawer-layer">
    <div className="cap-overlay" onClick={onClose} />
    <aside className="cap-drawer" role="dialog" aria-modal="true" aria-label={title}>
      <header className="cap-drawer-header">
        <div><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>
        <button className="icon-button" onClick={onClose} aria-label="关闭" title="关闭（Esc）"><X size={16} /></button>
      </header>
      <div className="cap-drawer-body">{children}</div>
      {footer && <footer className="cap-drawer-footer">{footer}</footer>}
    </aside>
  </div>
}