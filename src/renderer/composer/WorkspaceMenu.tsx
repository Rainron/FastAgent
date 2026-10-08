import { useCallback, useRef, useState } from 'react'
import { ChevronDown, Copy, Folder, FolderInput, FolderOpen, ShieldCheck, ShieldOff, TerminalSquare } from 'lucide-react'
import { useDismiss } from '../use-dismiss'
import { usePopoverClamp } from '../use-popover-clamp'

/** 项目指令文件信任状态；hasAgentContextFiles 为 false 时菜单项不展示。 */
export interface ProjectTrustState {
  trusted: boolean
  hasAgentContextFiles: boolean
}

/**
 * 输入框工具栏里的项目入口：显示当前项目名，点开是围绕这个目录的几个动作。
 * 动作本身都由外壳实现（打开目录、换项目、开终端都牵涉外壳状态），这里只负责菜单。
 */
export function WorkspaceMenu({ name, path, compact, onReveal, onCopyPath, onChangeFolder, onOpenTerminal, trust, onToggleTrust }: {
  name: string
  path: string
  /** 窄窗口下只显示图标，把宽度让给右侧的运行配置 */
  compact: boolean
  onReveal: () => void
  onCopyPath: () => void
  onChangeFolder: () => void
  onOpenTerminal: () => void
  /** Project Trust：null 表示未加载或项目无指令文件，不展示入口 */
  trust?: ProjectTrustState | null
  onToggleTrust?: (trusted: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, ref)
  usePopoverClamp(menuRef, open)
  const run = (action: () => void) => () => { setOpen(false); action() }

  return <div className="workspace-menu-selector" ref={ref}>
    <button type="button" className="composer-chip workspace-menu-trigger" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} title={compact ? `${name}\n${path}` : path}>
      <Folder size={14} />
      {!compact && <span className="workspace-menu-label">{name}</span>}
      {!compact && <ChevronDown size={12} />}
    </button>
    {open && <div ref={menuRef} className="workspace-menu popover-card" role="menu" aria-label="项目目录">
      <button type="button" role="menuitem" className="workspace-menu-item" onClick={run(onReveal)}><FolderOpen size={13} />在资源管理器中显示</button>
      <div className="workspace-menu-divider" role="separator" />
      <button type="button" role="menuitem" className="workspace-menu-item" onClick={run(onCopyPath)}><Copy size={13} />复制路径</button>
      <button type="button" role="menuitem" className="workspace-menu-item" onClick={run(onChangeFolder)}><FolderInput size={13} />更换文件夹…</button>
      {trust?.hasAgentContextFiles && onToggleTrust && <div className="workspace-menu-divider" role="separator" />}
      {trust?.hasAgentContextFiles && onToggleTrust && (trust.trusted
        ? <button type="button" role="menuitem" className="workspace-menu-item" onClick={run(() => onToggleTrust(false))} title="撤销后下一轮起 AGENTS/CLAUDE 不再注入系统提示"><ShieldOff size={13} />撤销项目信任</button>
        : <button type="button" role="menuitem" className="workspace-menu-item" onClick={run(() => onToggleTrust(true))} title="信任后下一轮起 AGENTS/CLAUDE 注入系统提示"><ShieldCheck size={13} />信任项目指令文件</button>)}
      <div className="workspace-menu-divider" role="separator" />
      <button type="button" role="menuitem" className="workspace-menu-item" onClick={run(onOpenTerminal)}><TerminalSquare size={13} />在终端中打开</button>
    </div>}
  </div>
}
