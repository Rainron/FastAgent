import React from 'react'
import { ChevronLeft, ChevronRight, Command, Moon, PanelLeft, Sun } from 'lucide-react'
import type { AppTheme } from '../../shared/types'
import { WindowControls } from './WindowControls'
import type { WorkspaceSection } from './workspace-types'

export interface WorkspaceTitlebarProps {
  section: WorkspaceSection
  /** 前进/后退按钮的可用性由导航栈位置决定。 */
  canGoBack: boolean
  canGoForward: boolean
  workspaceRoot: string | null
  effectiveDark: boolean
  onToggleSidebar: () => void
  onStepHistory: (direction: -1 | 1) => void
  onNavigate: (section: WorkspaceSection) => void
  onOpenSettings: () => void
  onToggleTheme: (next: AppTheme) => void
}

/**
 * 顶部标题栏。挂在主对话区之上，流式输出期间父组件每秒重渲染约 60 次，
 * 所以这里 memo，且所有回调由父组件用 useEventCallback 定住引用。
 */
export const WorkspaceTitlebar = React.memo(function WorkspaceTitlebar({
  section, canGoBack, canGoForward, workspaceRoot, effectiveDark,
  onToggleSidebar, onStepHistory, onNavigate, onOpenSettings, onToggleTheme
}: WorkspaceTitlebarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar-drag">
        <button className="icon-button no-drag" onClick={onToggleSidebar} aria-label="切换侧栏" title="切换侧栏"><PanelLeft size={16} /></button>
        <div className="window-nav no-drag">
          <button className="icon-button" onClick={() => onStepHistory(-1)} disabled={!canGoBack} aria-label="后退" title="后退"><ChevronLeft size={16} /></button>
          <button className="icon-button" onClick={() => onStepHistory(1)} disabled={!canGoForward} aria-label="前进" title="前进"><ChevronRight size={16} /></button>
        </div>
        <span className="window-title">{workspaceRoot ? workspaceRoot.split('\\').pop() : 'FastAgent'}</span>
      </div>
      <div className="tb-center seg no-drag" role="tablist" aria-label="视图切换">
        <button role="tab" aria-selected={section === 'chats'} className={section === 'chats' ? 'on' : ''} onClick={() => onNavigate('chats')}>主界面</button>
        <button role="tab" aria-selected={section === 'settings'} className={section === 'settings' ? 'on' : ''} onClick={onOpenSettings}>设置</button>
      </div>
      <div className="titlebar-actions no-drag">
        <button className="icon-button" onClick={() => onNavigate('search')} aria-label="搜索与命令" title="搜索与命令"><Command size={15} /></button>
        <button className="icon-button" aria-label="切换主题" title="切换主题" onClick={() => onToggleTheme(effectiveDark ? 'light' : 'dark')}>
          {effectiveDark ? <Moon size={15} /> : <Sun size={15} />}
        </button>
        <WindowControls />
      </div>
    </header>
  )
})
