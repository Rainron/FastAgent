import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useDrawerExit } from '../../../use-drawer-exit'

/**
 * 右侧 Drawer：创建/编辑不在主页面驻留，点开临时覆盖在内容上方。
 * 图标与徽章可选，供详情抽屉统一「图标 + 名称 + 来源 + 启用状态」的头部布局。
 */
export function CapabilityDrawer({ title, subtitle, icon, badges, onClose, children, footer }: {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  badges?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const drawerRef = useRef<HTMLElement>(null)
  const { closing, requestClose } = useDrawerExit(onClose)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [requestClose])

  useEffect(() => {
    // 键盘焦点移进抽屉；关闭时还回触发打开的元素，否则焦点会丢到 body
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    drawerRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  return <div className={`cap-drawer-layer${closing ? ' closing' : ''}`}>
    <div className="cap-overlay" onClick={requestClose} />
    <aside className="cap-drawer" ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}>
      <header className="cap-drawer-header">
        <div className="cap-drawer-title">
          {icon && <span className="cap-drawer-icon">{icon}</span>}
          <div><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>
          {badges && <div className="cap-drawer-badges">{badges}</div>}
        </div>
        <button className="icon-button" onClick={requestClose} aria-label="关闭" title="关闭（Esc）"><X size={16} /></button>
      </header>
      <div className="cap-drawer-body">{children}</div>
      {footer && <footer className="cap-drawer-footer">{footer}</footer>}
    </aside>
  </div>
}
