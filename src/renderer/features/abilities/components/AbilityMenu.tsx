import { useCallback, useRef, useState, type ReactNode } from 'react'
import { useDismiss } from '../../../use-dismiss'

export interface AbilityMenuItem {
  key: string
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

/** 轻量下拉菜单：项目未引入 radix dropdown，关闭行为走公共的 useDismiss。 */
export function AbilityMenu({ trigger, items, align = 'end', label }: { trigger: ReactNode; items: AbilityMenuItem[]; align?: 'start' | 'end'; label: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, root)

  return <div className="ability-menu" ref={root}>
    <button type="button" className="ability-menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((value) => !value)}>{trigger}</button>
    {open && <div className={`ability-menu-list align-${align}`} role="menu">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={item.danger ? 'danger' : ''}
          disabled={item.disabled}
          onClick={() => { setOpen(false); item.onSelect() }}
        >{item.icon}{item.label}</button>
      ))}
    </div>}
  </div>
}
