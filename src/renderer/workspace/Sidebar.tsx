import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, Check, ChevronDown, ChevronLeft, ChevronRight, Folder, FolderOpen, Gauge, MessageSquare, MessagesSquare,
  MoreHorizontal, MoreVertical, Pencil, Plus, Puzzle, Search, Sparkles, Trash2
} from 'lucide-react'
import type { AuthSnapshot, ConversationRunState } from '../../shared/types'
import type { CompactionStates } from '../conversation/compaction-state'
import { CONVERSATION_TITLE_MAX } from '../conversation/conversation-meta'
import { projectRunStatus, runStatusPresentation } from '../run-status'
import type { SidebarSectionState } from '../sidebar-sections'
import type { WorkspaceConversation, WorkspaceProject, WorkspaceSection } from './workspace-types'

/** 未按项目筛选时列表是混排的，给项目会话打个标记才能和快速对话区分开。 */
export function ConversationProjectTag({ projects, projectId }: { projects: WorkspaceProject[]; projectId: string | null }) {
  if (!projectId) return null
  const project = projects.find((item) => item.id === projectId)
  if (!project) return null
  return <span className="conversation-project-tag">{project.name}</span>
}

export function ItemActions({ onDelete, onArchive, onBatch, onInspect, onOpenFolder, openFolderLabel = '打开本地目录', onRename }: { onDelete: () => void; onArchive: () => void; onBatch: () => void; onInspect?: () => void; onOpenFolder?: () => void; openFolderLabel?: string; onRename?: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return <div ref={ref} className="item-actions"><button className="item-actions-trigger" onClick={() => setOpen((value) => !value)} aria-label="打开管理菜单" title="管理" aria-expanded={open}><MoreVertical size={15} /></button>{open && <div className="item-actions-menu" role="menu">{onInspect && <button onClick={() => { onInspect(); setOpen(false) }} role="menuitem"><Gauge size={14} />会话详情</button>}{onOpenFolder && <button onClick={() => { onOpenFolder(); setOpen(false) }} role="menuitem"><FolderOpen size={14} />{openFolderLabel}</button>}{onRename && <button onClick={() => { onRename(); setOpen(false) }} role="menuitem"><Pencil size={14} />重命名</button>}<button onClick={() => { onArchive(); setOpen(false) }} role="menuitem"><Archive size={14} />归档</button><button onClick={() => { onDelete(); setOpen(false) }} role="menuitem"><Trash2 size={14} />删除</button><button onClick={() => { onBatch(); setOpen(false) }} role="menuitem"><Check size={14} />批量管理</button></div>}</div>
}

/**
 * 侧栏会话标题的内联编辑框。挂载即全选，方便直接覆写自动生成的标题。
 * Enter / 失焦提交，Esc 取消；提交与取消都由父组件退出编辑态。
 */
function RecentTitleEditor({ title, onCommit, onCancel }: { title: string; onCommit: (value: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(title)
  // Esc 取消后 blur 会紧接着触发，用它挡掉那次多余的提交
  const cancelled = useRef(false)
  return <input
    className="recent-title-input"
    value={draft}
    autoFocus
    aria-label="重命名会话"
    maxLength={CONVERSATION_TITLE_MAX}
    onFocus={(event) => event.currentTarget.select()}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => { if (!cancelled.current) onCommit(draft) }}
    onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); onCommit(draft) }
      if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; onCancel() }
    }}
  />
}

/** 流式输出期间父组件每帧重渲染，侧栏内容与之无关，memo 挡住。 */
export const Sidebar = React.memo(function Sidebar({ collapsed, sectionStates, onToggleSection, section, projects, conversations, runStates, compactionStates, onReadRun, selectedProjectId, selectedConversationId, onInspectConversation, onStartBatch, onDeleteProject, onArchiveProject, onOpenProjectFolder, onOpenConversationFolder, onDeleteConversation, onArchiveConversation, onRenameConversation, onNavigate, onNewChat, onToggle, onPickWorkspace, onSelectConversation, onSelectProject, onAccountAction, auth, onOpenConversations, abilityAlerts }: { collapsed: boolean; section: WorkspaceSection; /** 待处理能力数；必须是原始值，传数组/对象会穿透 memo */ abilityAlerts: number; projects: WorkspaceProject[]; conversations: WorkspaceConversation[]; selectedProjectId: string | null; selectedConversationId: string | null; onInspectConversation: (id: string) => void; onStartBatch: (kind: 'projects' | 'conversations') => void; onDeleteProject: (id: string) => void; onArchiveProject: (id: string) => void; onOpenProjectFolder: (path: string) => void; onOpenConversationFolder: (id: string) => void; onDeleteConversation: (id: string) => void; onArchiveConversation: (id: string) => void; onRenameConversation: (id: string, title: string) => void; onNavigate: (section: WorkspaceSection) => void; onNewChat: () => void; onToggle: () => void; onPickWorkspace: () => void; onSelectConversation: (item: WorkspaceConversation) => void; onSelectProject: (item: WorkspaceProject) => void; onAccountAction: () => void; auth: AuthSnapshot; onOpenConversations: () => void; runStates: Record<string, ConversationRunState>; compactionStates: CompactionStates; onReadRun: (conversationId: string) => void; sectionStates: SidebarSectionState; onToggleSection: (section: keyof SidebarSectionState) => void }) {
  // 每个项目都要按全部 run 判定状态，展开一次复用，不在循环里反复 Object.values。
  const runStateList = useMemo(() => Object.values(runStates), [runStates])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  return <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
    <div className="sidebar-top"><button className="brand-button" onClick={onToggle} aria-label="切换侧栏" title="切换侧栏"><Sparkles size={17} /><span>FastAgent</span></button><button className="icon-button" onClick={onToggle} aria-label="收起侧栏" title="收起侧栏"><ChevronLeft size={16} /></button></div>
    <nav className="nav-list" aria-label="主导航">
      <button className={`nav-item ${section === 'chats' ? 'active' : ''}`} onClick={onNewChat}><MessageSquare size={16} /><span>新对话</span></button>
      <button className={`nav-item ${section === 'search' ? 'active' : ''}`} onClick={() => onNavigate('search')}><Search size={16} /><span>搜索</span></button>
      <button className={`nav-item ${section === 'conversations' ? 'active' : ''}`} onClick={onOpenConversations}><MessagesSquare size={16} /><span>会话</span></button>
      <button className={`nav-item ${section === 'projects' ? 'active' : ''}`} onClick={() => onNavigate('projects')}><Folder size={16} /><span>工作区</span></button>
      <button className={`nav-item ${section === 'capabilities' ? 'active' : ''}`} onClick={() => onNavigate('capabilities')}><Puzzle size={16} /><span>能力</span>{abilityAlerts > 0 && <span className="nav-badge" title={`${abilityAlerts} 个能力需要处理`}>{abilityAlerts}</span>}</button>
    </nav>
    <section className="sidebar-section"><button className="section-label" onClick={() => onToggleSection('workspace')} aria-expanded={sectionStates.workspace}><span className="section-label-title"><span>工作区</span><ChevronDown size={13} className={sectionStates.workspace ? '' : 'collapsed'} /></span><span className="section-label-actions"><span className="mini-button" onClick={(event) => { event.stopPropagation(); onPickWorkspace() }} aria-label="添加工作区" title="添加工作区"><Plus size={14} /></span></span></button>{sectionStates.workspace && projects.filter((project) => !project.archived).map((project) => <div className={`workspace-item project-item ${selectedProjectId === project.id ? 'active' : ''}`} key={project.id}><button className="workspace-item-main" onClick={() => onSelectProject(project)}><span className="run-status-slot">{(() => { const presentation = runStatusPresentation(projectRunStatus(runStateList, project.id)); return presentation ? <span className={`run-status-dot ${presentation.tone}`} title={presentation.label} /> : null })()}</span><span>{project.name}</span></button><button className="item-open-folder" onClick={() => onOpenProjectFolder(project.path)} aria-label={`打开 ${project.name} 的本地目录`} title="打开本地目录"><FolderOpen size={14} /></button><ItemActions onDelete={() => onDeleteProject(project.id)} onArchive={() => onArchiveProject(project.id)} onBatch={() => onStartBatch('projects')} onOpenFolder={() => onOpenProjectFolder(project.path)} /></div>)}</section>
    <section className="sidebar-section recent"><button className="section-label" onClick={() => onToggleSection('recent')} aria-expanded={sectionStates.recent}><span className="section-label-title"><span>最近对话</span><ChevronDown size={13} className={sectionStates.recent ? '' : 'collapsed'} /></span></button>{sectionStates.recent && <>{conversations.filter((conversation) => !conversation.archived).map((conversation) => <div className={`workspace-item recent-item ${selectedConversationId === conversation.id ? 'active' : ''}`} key={conversation.id}>{renamingId === conversation.id ? <RecentTitleEditor title={conversation.title} onCommit={(value) => { setRenamingId(null); onRenameConversation(conversation.id, value) }} onCancel={() => setRenamingId(null)} /> : <><button className="workspace-item-main" onClick={() => { void window.fastAgent.chat.markRead(conversation.id); onReadRun(conversation.id); onSelectConversation(conversation) }}><span className="run-status-slot">{compactionStates[conversation.id]?.status === 'running' ? <span className="run-status-dot running" title="压缩中" /> : (() => { const presentation = runStatusPresentation(runStates[conversation.id]); return presentation ? <span className={`run-status-dot ${presentation.tone}`} title={presentation.label} /> : null })()}</span><span className="recent-copy"><span className="recent-title">{conversation.title}</span><small>{<ConversationProjectTag projects={projects} projectId={conversation.projectId} />}</small></span><time>{conversation.meta}</time></button><ItemActions onDelete={() => onDeleteConversation(conversation.id)} onArchive={() => onArchiveConversation(conversation.id)} onBatch={() => onStartBatch('conversations')} onInspect={() => onInspectConversation(conversation.id)} onOpenFolder={() => onOpenConversationFolder(conversation.id)} openFolderLabel="打开会话目录" onRename={() => setRenamingId(conversation.id)} /></>}</div>)}<button className="recent-more" onClick={onOpenConversations}>查看全部<ChevronRight size={13} /></button></>}</section>
    <div className="sidebar-bottom"><div className="account-row"><div className="avatar">{auth.user?.display_name?.slice(0, 1) || auth.user?.username?.slice(0, 1) || 'F'}</div><div className="account-copy"><strong>{auth.user?.display_name || auth.user?.username || '账户'}</strong></div><button className="icon-button" onClick={onAccountAction} aria-label="账户菜单" title="账户菜单"><MoreHorizontal size={16} /></button></div></div>
  </aside>
})
