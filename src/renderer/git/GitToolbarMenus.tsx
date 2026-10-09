import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, GitBranch, MoreHorizontal } from 'lucide-react'
import { useDismiss } from '../use-dismiss'
import { usePopoverClamp } from '../use-popover-clamp'

/**
 * 顶栏的分支切换器：按钮显示当前分支，点开是完整的分支 / 远程 / stash 列表。
 * 开合由面板控制——列表里的动作（切换、看历史、弹对话框）执行时要顺手把它收起来。
 */
export function GitBranchSwitcher({ label, open, onOpenChange, children }: {
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  useDismiss(open, close, ref)
  usePopoverClamp(menuRef, open)
  return <div className="git-toolbar-popover-anchor" ref={ref}>
    <button type="button" className="git-branch-switcher" aria-haspopup="dialog" aria-expanded={open} onClick={() => onOpenChange(!open)} title="切换或管理分支">
      <GitBranch size={14} />
      <span className="git-ellipsis">{label}</span>
      <ChevronDown size={13} />
    </button>
    {open && <div ref={menuRef} className="git-branch-popover" role="dialog" aria-label="分支">{children}</div>}
  </div>
}

export interface GitMenuItem {
  key: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  /** 在这一项之前画分隔线，把同步、整合、维护几类动作分开 */
  separatorBefore?: boolean
  onSelect: () => void
}

/** 顶栏「⋯」：低频动作收在这里，顶栏只留 fetch / pull / push 三个最常用的。 */
export function GitMoreMenu({ items }: { items: GitMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, ref)
  usePopoverClamp(menuRef, open)
  return <div className="git-toolbar-popover-anchor" ref={ref}>
    <button type="button" className="git-tool-button icon" aria-label="更多 Git 操作" title="更多操作" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <MoreHorizontal size={15} />
    </button>
    {open && <div ref={menuRef} className="git-more-menu" role="menu">
      {items.map((item) => <div key={item.key}>
        {item.separatorBefore && <div className="git-more-separator" role="separator" />}
        <button type="button" role="menuitem" className={`git-more-item${item.danger ? ' danger' : ''}`} disabled={item.disabled}
          onClick={() => { setOpen(false); item.onSelect() }}>
          <span className="git-more-icon" aria-hidden="true">{item.icon}</span>{item.label}
        </button>
      </div>)}
    </div>}
  </div>
}
