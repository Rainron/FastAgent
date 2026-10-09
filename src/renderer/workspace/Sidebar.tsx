import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive, Check, ChevronDown, ChevronLeft, ChevronRight, FileDown, Folder, FolderOpen, Gauge, MessageSquare, MessagesSquare,
  Blocks, MoreHorizontal, MoreVertical, Pencil, Plus, Puzzle, Search, Sparkles, Trash2, Wand2
} from 'lucide-react'
import type { AuthSnapshot, ConversationRunState } from '../../shared/types'
import type { CompactionStates } from '../conversation/compaction-state'
import { CONVERSATION_TITLE_MAX } from '../conversation/conversation-meta'
import { projectRunStatus, runStatusPresentation } from '../run-status'
import { useDelayedUnmount } from '../use-delayed-unmount'
import { MOTION_DURATIONS } from '../motion'
import { type SidebarSectionState } from '../sidebar-sections'
import { useEventCallback } from '../use-event-callback'
import { useScrollAnchor } from '../scroll-anchor'
import { anchorMenuPosition } from './item-actions-position'
import { useProjectConversations } from './hooks/use-project-conversations'
import { newChatActionLabel } from './sidebar-actions'
import { clampSearchIndex, nextSearchIndex } from './sidebar-search-nav'
import { runMarkGlyph, runMarkKind } from './sidebar-status'
import { ScrollingTitle } from './ScrollingTitle'
import { Collapse } from '../Collapse'
import { clampSidebarWidth, readSidebarWidth, writeSidebarWidth } from './sidebar-width'
import { filterConversations, filterProjects } from './sidebar-filter'
import { applyProjectOrder, shiftDirection } from './project-order'
import { useProjectReorder } from './hooks/use-project-reorder'
import { useSidebarPhase } from './hooks/use-sidebar-phase'
import { useExitingItems } from '../use-presence'
import type { WorkspaceConversation, WorkspaceProject, WorkspaceSection } from './workspace-types'

/** 搜索开着时点分区以外的任何地方就收起并清空；onDismiss 需引用稳定，否则每次渲染都要重挂监听。 */
function useDismissOutside<T extends HTMLElement>(active: boolean, onDismiss: () => void) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!active) return
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onDismiss() }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [active, onDismiss])
  return ref
}

/**
 * 分区头里的搜索输入框：打开即聚焦，Esc 关闭并清空，交给父组件收敛开关状态。
 * 上下方向键在结果里移动、回车进入当前项，焦点始终留在输入框，边改词边选。
 */
function SidebarSearchInput({ value, placeholder, onChange, onClose, onMove, onSubmit }: { value: string; placeholder: string; onChange: (value: string) => void; onClose: () => void; onMove: (direction: 1 | -1) => void; onSubmit: () => void }) {
  return <div className="sidebar-search">
    <Search size={13} aria-hidden="true" />
    <input
      value={value}
      autoFocus
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
        // 方向键默认会在输入框里移动光标，结果列表的选取要抢在前面
        if (event.key === 'ArrowDown') { event.preventDefault(); onMove(1); return }
        if (event.key === 'ArrowUp') { event.preventDefault(); onMove(-1); return }
        if (event.key === 'Enter') { event.preventDefault(); onSubmit() }
      }}
    />
  </div>
}

/** 未按项目筛选时列表是混排的，给项目会话打个标记才能和快速对话区分开。 */
export function ConversationProjectTag({ projects, projectId }: { projects: WorkspaceProject[]; projectId: string | null }) {
  if (!projectId) return null
  const project = projects.find((item) => item.id === projectId)
  if (!project) return null
  return <span className="conversation-project-tag">{project.name}</span>
}

export function ItemActions({ onDelete, onArchive, onBatch, onInspect, onOpenFolder, openFolderLabel = '打开本地目录', onRename, onExport, onDistill }: { onDelete: () => void; onArchive: () => void; onBatch: () => void; onInspect?: () => void; onOpenFolder?: () => void; openFolderLabel?: string; onRename?: () => void; onExport?: () => void; onDistill?: () => void }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const mounted = useDelayedUnmount(open, MOTION_DURATIONS.popoverClose)
  useEffect(() => {
    if (!open) return
    // 菜单在 portal 里，不在 ref 的 DOM 子树内，要单独放行，否则 pointerdown 会抢在 click 前把它关掉
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  // 菜单高度随可用操作数量变，量出来再定位；滚动与缩放时重算，否则 fixed 菜单会和列表项脱节。
  // 依赖必须带上 mounted：useDelayedUnmount 是在 effect 里置的 mounted，open 变 true 的那一帧
  // 菜单还没进 DOM，只依赖 open 的话这次量不到、下次又不跑，菜单会一直停在 visibility: hidden。
  useLayoutEffect(() => {
    if (!open || !mounted) return
    const place = () => {
      const trigger = triggerRef.current
      const menu = menuRef.current
      if (!trigger || !menu) return
      const rect = trigger.getBoundingClientRect()
      setPosition(anchorMenuPosition(rect, { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, mounted])
  const menu = mounted && <div
    ref={menuRef}
    className={`item-actions-menu${open ? '' : ' closing'}`}
    role="menu"
    // 定位算完前先藏着，避免先在左上角闪一帧
    style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
  >{onInspect && <button onClick={() => { onInspect(); setOpen(false) }} role="menuitem"><Gauge size={14} />会话详情</button>}{onOpenFolder && <button onClick={() => { onOpenFolder(); setOpen(false) }} role="menuitem"><FolderOpen size={14} />{openFolderLabel}</button>}{onRename && <button onClick={() => { onRename(); setOpen(false) }} role="menuitem"><Pencil size={14} />重命名</button>}{onExport && <button onClick={() => { onExport(); setOpen(false) }} role="menuitem"><FileDown size={14} />导出会话</button>}{onDistill && <button onClick={() => { onDistill(); setOpen(false) }} role="menuitem"><Wand2 size={14} />提炼为技能</button>}<button onClick={() => { onArchive(); setOpen(false) }} role="menuitem"><Archive size={14} />归档</button><button onClick={() => { onDelete(); setOpen(false) }} role="menuitem"><Trash2 size={14} />删除</button><button onClick={() => { onBatch(); setOpen(false) }} role="menuitem"><Check size={14} />批量管理</button></div>
  return <div ref={ref} className="item-actions"><button ref={triggerRef} className="item-actions-trigger" onClick={() => { setPosition(null); setOpen((value) => !value) }} aria-label="打开管理菜单" title="管理" aria-expanded={open}><MoreVertical size={15} /></button>{menu && createPortal(menu, document.body)}</div>
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

/** 会话行当前要亮的状态；压缩也算「进行中」，否则压缩那几十秒侧栏看不出这条会话在忙。 */
function conversationMark(conversationId: string, runStates: Record<string, ConversationRunState>, compactionStates: CompactionStates) {
  const presentation = compactionStates[conversationId]?.status === 'running'
    ? { tone: 'running' as const, label: '正在压缩上下文' }
    : runStatusPresentation(runStates[conversationId])
  const kind = runMarkKind(presentation?.tone)
  return presentation && kind ? { ...presentation, kind } : null
}

type ConversationMark = NonNullable<ReturnType<typeof conversationMark>>

/**
 * 会话行的状态标记，统一画在行尾（见 runMarkKind）：进行中是转圈 / 待处理，已结束未看过的是未读标记。
 * 没有状态时什么也不渲染。形状各不相同，不只靠颜色区分。
 */
function ConversationStatusMark({ mark }: { mark: ConversationMark | null }) {
  if (!mark) return null
  const glyph = runMarkGlyph(mark.tone)
  return <span className={`row-status-mark ${mark.kind} ${mark.tone} glyph-${glyph}`} role="img" aria-label={mark.label} title={mark.label}>{glyph === 'spinner' && <i className="run-mark-spinner" />}</span>
}

/** 会话条目的一套操作，最近对话与项目下挂的会话共用。 */
interface ConversationItemActions {
  onDelete: (id: string) => void
  onArchive: (id: string) => void
  onBatch: () => void
  onInspect: (id: string) => void
  onOpenFolder: (id: string) => void
  onRename: (id: string, title: string) => void
  onExport: (id: string) => void
  onDistill: (id: string) => void
}

/**
 * 项目下挂的最新会话，默认跟着项目一起展开。
 *
 * 会话列表单独拉：侧栏「最近」是全量口径的前若干条，按项目过滤它会把排在后面的会话漏掉。
 */
function ProjectConversations({ projectId, expanded, refreshKey, selectedConversationId, runStates, compactionStates, renamingId, actions, onSelect, onReadRun, onStartRename, onStopRename }: {
  projectId: string
  expanded: boolean
  refreshKey: unknown
  selectedConversationId: string | null
  runStates: Record<string, ConversationRunState>
  compactionStates: CompactionStates
  renamingId: string | null
  /** 与「最近对话」同一套条目操作，行为不能因为挂在项目下面而缩水。 */
  actions: ConversationItemActions
  onSelect: (item: WorkspaceConversation) => void
  onReadRun: (conversationId: string) => void
  onStartRename: (id: string) => void
  onStopRename: () => void
}) {
  const { items, total, showAll, loaded, toggleShowAll } = useProjectConversations(projectId, expanded, refreshKey)
  // 「显示全部 / 收起」换的是整批条目，不算删除；只有同一批里消失的才播退场
  const rows = useExitingItems(items, (conversation) => conversation.id, MOTION_DURATIONS.status, showAll)
  // 收起会一次抽掉十几行，不锁住这颗按钮的位置，侧栏会整段往下滑。
  const { ref: moreRef, anchor } = useScrollAnchor<HTMLButtonElement>()
  return <Collapse open={expanded}>{!loaded ? null : !items.length ? <p className="project-conversations-empty">还没有会话</p> : <div className="project-conversations">
    {rows.map(({ item: conversation, exiting }) => { const mark = conversationMark(conversation.id, runStates, compactionStates); return <div key={conversation.id} className={`project-conversation${exiting ? ' exiting' : ''}${selectedConversationId === conversation.id ? ' active' : ''}${mark?.kind === 'unread' ? ' unread' : ''}`}>
      {renamingId === conversation.id
        ? <RecentTitleEditor title={conversation.title} onCommit={(value) => { onStopRename(); actions.onRename(conversation.id, value) }} onCancel={onStopRename} />
        : <><button className="project-conversation-main" onClick={() => { void window.fastAgent.chat.markRead(conversation.id); onReadRun(conversation.id); onSelect(conversation) }}>
          <ConversationStatusMark mark={mark} />
          <ScrollingTitle className="row-title" text={conversation.title} />
        </button><ItemActions
          onDelete={() => actions.onDelete(conversation.id)}
          onArchive={() => actions.onArchive(conversation.id)}
          onBatch={() => actions.onBatch()}
          onInspect={() => actions.onInspect(conversation.id)}
          onOpenFolder={() => actions.onOpenFolder(conversation.id)}
          openFolderLabel="打开会话目录"
          onRename={() => onStartRename(conversation.id)}
          onExport={() => actions.onExport(conversation.id)}
          onDistill={() => actions.onDistill(conversation.id)}
        /></>}
    </div> })}
    {(showAll || total > items.length) && <button className="project-conversations-more" ref={moreRef} onClick={() => { anchor(); toggleShowAll() }}>{showAll ? '收起' : '展开显示'}</button>}
  </div>}</Collapse>
}

/** 流式输出期间父组件每帧重渲染，侧栏内容与之无关，memo 挡住。 */
export const Sidebar = React.memo(function Sidebar({ collapsed, sectionStates, onToggleSection, section, projects, conversations, runStates, compactionStates, onReadRun, selectedProjectId, selectedConversationId, onInspectConversation, onStartBatch, onDeleteProject, onArchiveProject, onOpenProjectFolder, onOpenConversationFolder, onDeleteConversation, onArchiveConversation, onRenameConversation, onExportConversation, onDistillSkill, onNavigate, onNewChat, onNewChatInSection, onNewChatInProject, onToggle, onPickWorkspace, onSelectConversation, onSelectProject, onAccountAction, auth, onOpenConversations, abilityAlerts }: { collapsed: boolean; section: WorkspaceSection; /** 待处理能力数；必须是原始值，传数组/对象会穿透 memo */ abilityAlerts: number; projects: WorkspaceProject[]; conversations: WorkspaceConversation[]; selectedProjectId: string | null; selectedConversationId: string | null; onInspectConversation: (id: string) => void; onStartBatch: (kind: 'projects' | 'conversations') => void; onDeleteProject: (id: string) => void; onArchiveProject: (id: string) => void; onOpenProjectFolder: (path: string) => void; onOpenConversationFolder: (id: string) => void; onDeleteConversation: (id: string) => void; onArchiveConversation: (id: string) => void; onRenameConversation: (id: string, title: string) => void; onExportConversation: (id: string) => void; onDistillSkill: (id: string) => void; onNavigate: (section: WorkspaceSection) => void; onNewChat: () => void; /** 最近对话分区头的加号：未选项目建快速对话，选了项目就建该项目下的对话 */ onNewChatInSection: () => void; /** 项目行上的加号：切到该项目并在它下面开一个空会话 */ onNewChatInProject: (project: WorkspaceProject) => void; onToggle: () => void; onPickWorkspace: () => void; onSelectConversation: (item: WorkspaceConversation) => void; onSelectProject: (item: WorkspaceProject) => void; onAccountAction: () => void; auth: AuthSnapshot; onOpenConversations: () => void; runStates: Record<string, ConversationRunState>; compactionStates: CompactionStates; onReadRun: (conversationId: string) => void; sectionStates: SidebarSectionState; onToggleSection: (section: keyof SidebarSectionState) => void }) {
  // 每个项目都要按全部 run 判定状态，展开一次复用，不在循环里反复 Object.values。
  const runStateList = useMemo(() => Object.values(runStates), [runStates])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // 点开的项目在名字下面直接摊开自己的会话；当前项目默认就是展开的，用户不用再点一次。
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set(selectedProjectId ? [selectedProjectId] : []))
  // 手动收起一个未选中的项目时它会顺带被选中，选中态同步过来不能再把它展开回去，否则收起要点两次
  const collapsedByClick = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedProjectId) return
    if (collapsedByClick.current === selectedProjectId) { collapsedByClick.current = null; return }
    setExpandedProjects((current) => current.has(selectedProjectId) ? current : new Set(current).add(selectedProjectId))
  }, [selectedProjectId])
  // 搜索结果的键盘选取下标；-1 表示还没选。结果集变了就夹回第一条。
  const [projectHighlight, setProjectHighlight] = useState(-1)
  const [recentHighlight, setRecentHighlight] = useState(-1)
  const conversationActions: ConversationItemActions = {
    onDelete: onDeleteConversation,
    onArchive: onArchiveConversation,
    onBatch: () => onStartBatch('conversations'),
    onInspect: onInspectConversation,
    onOpenFolder: onOpenConversationFolder,
    onRename: onRenameConversation,
    onExport: onExportConversation,
    onDistill: onDistillSkill
  }
  const toggleProject = (id: string) => setExpandedProjects((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  const [projectQuery, setProjectQuery] = useState('')
  const [projectSearchOpen, setProjectSearchOpen] = useState(false)
  const [recentQuery, setRecentQuery] = useState('')
  const [recentSearchOpen, setRecentSearchOpen] = useState(false)
  // 默认按名称排、用户可按住拖拽调整，顺序固定：跟着「最近操作」排会让刚点过的项目跳到最前，下一次再点时目标已经换了位置。
  const activeProjects = useMemo(() => projects.filter((project) => !project.archived), [projects])
  // 搜索时列表是过滤后的子集，拿它算落点会把没显示的项目挤乱，拖拽只在完整列表上开放
  const reorder = useProjectReorder(!projectSearchOpen)
  const orderedProjects = useMemo(() => applyProjectOrder(activeProjects, reorder.order), [activeProjects, reorder.order])
  const visibleProjects = useMemo(
    () => filterProjects(orderedProjects, projectSearchOpen ? projectQuery : ''),
    [orderedProjects, projectQuery, projectSearchOpen]
  )
  const projectDragClass = (index: number) => {
    const drag = reorder.drag
    if (!drag) return ''
    if (index === drag.from) return ' dragging'
    const shift = shiftDirection(index, drag.from, drag.dropIndex)
    return shift < 0 ? ' shift-up' : shift > 0 ? ' shift-down' : ''
  }
  const visibleConversations = useMemo(
    () => filterConversations(conversations.filter((conversation) => !conversation.archived), recentSearchOpen ? recentQuery : ''),
    [conversations, recentQuery, recentSearchOpen]
  )
  // 删除 / 归档的会话行先收起淡出再移走；搜索过滤不算删除，以搜索词作重置键，打字时不播退场
  const recentRows = useExitingItems(visibleConversations, (conversation) => conversation.id, MOTION_DURATIONS.status, `${recentSearchOpen}|${recentQuery}`)
  // 分区收起时点搜索，先展开分区，否则输入框和结果都藏着
  const openSearch = (key: keyof SidebarSectionState, open: () => void) => {
    open()
    if (!sectionStates[key]) onToggleSection(key)
  }
  // 加号的语义随项目选中状态变，文案也要跟着变，否则用户不知道新对话会落到哪
  const newChatLabel = newChatActionLabel(projects, selectedProjectId)
  const closeProjectSearch = useEventCallback(() => { setProjectSearchOpen(false); setProjectQuery(''); setProjectHighlight(-1) })
  const closeRecentSearch = useEventCallback(() => { setRecentSearchOpen(false); setRecentQuery(''); setRecentHighlight(-1) })
  // 改词、结果变少都会让旧下标指错行，夹回第一条
  useEffect(() => { setProjectHighlight((current) => current < 0 ? current : clampSearchIndex(current, visibleProjects.length)) }, [visibleProjects])
  useEffect(() => { setRecentHighlight((current) => current < 0 ? current : clampSearchIndex(current, visibleConversations.length)) }, [visibleConversations])
  const openProject = (project: WorkspaceProject) => {
    const fromSearch = projectSearchOpen
    closeProjectSearch()
    // 项目行就是展开开关：已展开的点一次就收起，不区分它是不是当前选中的项目。
    // 但从搜索结果里选中是「打开」语义，不能把命中的项目收起来。
    if (fromSearch) setExpandedProjects((current) => current.has(project.id) ? current : new Set(current).add(project.id))
    else {
      if (expandedProjects.has(project.id) && selectedProjectId !== project.id) collapsedByClick.current = project.id
      toggleProject(project.id)
    }
    onSelectProject(project)
  }
  const openConversation = (conversation: WorkspaceConversation) => {
    closeRecentSearch()
    void window.fastAgent.chat.markRead(conversation.id)
    onReadRun(conversation.id)
    onSelectConversation(conversation)
  }
  const workspaceSectionRef = useDismissOutside<HTMLElement>(projectSearchOpen, closeProjectSearch)
  const recentSectionRef = useDismissOutside<HTMLElement>(recentSearchOpen, closeRecentSearch)
  // 侧栏在窗口左侧：向右拖变宽。收起态没有可拖的宽度，把手也不渲染。
  const [width, setWidth] = useState(() => readSidebarWidth(window.localStorage))
  const phase = useSidebarPhase(collapsed)
  const startResize = (event: React.PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const move = (moveEvent: PointerEvent) => setWidth(clampSidebarWidth(startWidth + (moveEvent.clientX - startX)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setWidth((current) => { writeSidebarWidth(window.localStorage, current); return current })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // narrow 只管宽度，collapsed 管收起后的布局；两者在过渡阶段分开，文字才能边缩边淡出而不是当场消失
  const phaseClass = phase === 'collapsed' ? 'narrow collapsed' : phase === 'collapsing' ? 'narrow collapsing' : phase
  return <aside className={`sidebar ${phaseClass}`} style={{ ...(collapsed ? {} : { width, flexBasis: width }), ['--sidebar-expanded-width' as string]: `${width}px` }}>
    <div className="sidebar-top"><button className="brand-button" onClick={onToggle} aria-label="切换侧栏" title="切换侧栏"><span className="brand-logo" aria-hidden="true"><Sparkles size={15} /></span><span>FastAgent</span></button><button className="icon-button" onClick={onToggle} aria-label="收起侧栏" title="收起侧栏"><ChevronLeft size={16} /></button></div>
    {/* 导航与两个列表分区共用一个滚动容器：滚动条从「新对话」一路贯穿到最近对话，内容各自按高度排布 */}
    <div className="sidebar-scroll">
    <nav className="nav-list" aria-label="主导航">
      {/* 只在还没选中会话时算选中：进了某个会话，选中态交给列表里那一行，两处同时亮会分不清在哪 */}
      <button className={`nav-item ${section === 'chats' && !selectedConversationId ? 'active' : ''}`} onClick={onNewChat} aria-label="新对话" title="新对话"><MessageSquare size={16} /><span>新对话</span></button>
      <button className={`nav-item ${section === 'search' ? 'active' : ''}`} onClick={() => onNavigate('search')} aria-label="搜索" title="搜索"><Search size={16} /><span>搜索</span></button>
      <button className={`nav-item ${section === 'conversations' ? 'active' : ''}`} onClick={onOpenConversations} aria-label="会话" title="会话"><MessagesSquare size={16} /><span>会话</span></button>
      <button className={`nav-item ${section === 'projects' ? 'active' : ''}`} onClick={() => onNavigate('projects')} aria-label="工作区" title="工作区"><Folder size={16} /><span>工作区</span></button>
      <button className={`nav-item ${section === 'capabilities' ? 'active' : ''}`} onClick={() => onNavigate('capabilities')} aria-label="能力" title="能力"><Puzzle size={16} /><span>能力</span>{abilityAlerts > 0 && <span className="nav-badge" title={`${abilityAlerts} 个能力需要处理`}>{abilityAlerts}</span>}</button>
      <button className={`nav-item ${section === 'plugins' ? 'active' : ''}`} onClick={() => onNavigate('plugins')} aria-label="插件" title="插件"><Blocks size={16} /><span>插件</span></button>
    </nav>
    <div className="sidebar-lists">
    <section className={`sidebar-section workspace${sectionStates.workspace ? ' open' : ''}`} ref={workspaceSectionRef}><button className="section-label" onClick={() => onToggleSection('workspace')} aria-expanded={sectionStates.workspace}><span className="section-label-title"><span>工作区</span><ChevronDown size={13} className={sectionStates.workspace ? '' : 'collapsed'} /></span><span className="section-label-actions"><span className="mini-button" onClick={(event) => { event.stopPropagation(); onPickWorkspace() }} aria-label="添加工作区" title="添加工作区"><Plus size={14} /></span><span className={`mini-button${projectSearchOpen ? ' on' : ''}`} onClick={(event) => { event.stopPropagation(); if (projectSearchOpen) closeProjectSearch(); else openSearch('workspace', () => setProjectSearchOpen(true)) }} aria-label="搜索工作区" title="搜索工作区" aria-pressed={projectSearchOpen}><Search size={14} /></span></span></button>{sectionStates.workspace && projectSearchOpen && <SidebarSearchInput value={projectQuery} placeholder="搜索项目目录" onChange={setProjectQuery} onClose={closeProjectSearch} onMove={(direction) => setProjectHighlight((current) => nextSearchIndex(current, visibleProjects.length, direction))} onSubmit={() => { const project = visibleProjects[projectHighlight < 0 ? 0 : projectHighlight]; if (project) openProject(project) }} />}<Collapse open={sectionStates.workspace}><div className="sidebar-scroll-list" ref={reorder.listRef} onClickCapture={reorder.onClickCapture}>{visibleProjects.map((project, index) => <div className={`project-group${projectDragClass(index)}`} key={project.id} data-project-id={project.id}>{/* 项目行不画选中态：当前项目靠展开的会话列表和打开的文件夹图标表达，底色只给选中的会话 */}<div className={`workspace-item project-item${projectSearchOpen && index === projectHighlight ? ' highlighted' : ''}`} onPointerDown={(event) => reorder.onPointerDown(event, project.id)}><button className="workspace-item-main" aria-expanded={expandedProjects.has(project.id)} onClick={() => openProject(project)}>{(() => { const presentation = runStatusPresentation(projectRunStatus(runStateList, project.id)); return <span className={`project-folder${expandedProjects.has(project.id) ? ' open' : ''}`} title={presentation?.label}><Folder size={14} className="folder-closed" /><FolderOpen size={14} className="folder-open" />{presentation && <i className={`project-folder-badge ${presentation.tone}`} role="img" aria-label={presentation.label} />}</span> })()}<span className="row-title">{project.name}</span></button><button className="item-new-chat" onClick={() => { closeProjectSearch(); void onNewChatInProject(project) }} aria-label={`在 ${project.name} 下新建对话`} title="新建对话"><Plus size={14} /></button><ItemActions onDelete={() => onDeleteProject(project.id)} onArchive={() => onArchiveProject(project.id)} onBatch={() => onStartBatch('projects')} onOpenFolder={() => onOpenProjectFolder(project.path)} /></div><ProjectConversations projectId={project.id} expanded={expandedProjects.has(project.id)} refreshKey={conversations} selectedConversationId={selectedConversationId} runStates={runStates} compactionStates={compactionStates} renamingId={renamingId} actions={conversationActions} onSelect={onSelectConversation} onReadRun={onReadRun} onStartRename={setRenamingId} onStopRename={() => setRenamingId(null)} /></div>)}{projectSearchOpen && !visibleProjects.length && <p className="sidebar-search-empty">没有匹配的项目目录</p>}</div></Collapse></section>
    <section className={`sidebar-section recent${sectionStates.recent ? ' open' : ''}`} ref={recentSectionRef}><button className="section-label" onClick={() => onToggleSection('recent')} aria-expanded={sectionStates.recent}><span className="section-label-title"><span>最近对话</span><ChevronDown size={13} className={sectionStates.recent ? '' : 'collapsed'} /></span><span className="section-label-actions"><span className="mini-button" onClick={(event) => { event.stopPropagation(); closeRecentSearch(); if (!sectionStates.recent) onToggleSection('recent'); onNewChatInSection() }} aria-label={newChatLabel} title={newChatLabel}><Plus size={14} /></span><span className={`mini-button${recentSearchOpen ? ' on' : ''}`} onClick={(event) => { event.stopPropagation(); if (recentSearchOpen) closeRecentSearch(); else openSearch('recent', () => setRecentSearchOpen(true)) }} aria-label="搜索最近对话" title="搜索最近对话" aria-pressed={recentSearchOpen}><Search size={14} /></span></span></button><Collapse open={sectionStates.recent}>{recentSearchOpen && <SidebarSearchInput value={recentQuery} placeholder="搜索对话标题" onChange={setRecentQuery} onClose={closeRecentSearch} onMove={(direction) => setRecentHighlight((current) => nextSearchIndex(current, visibleConversations.length, direction))} onSubmit={() => { const conversation = visibleConversations[recentHighlight < 0 ? 0 : recentHighlight]; if (conversation) openConversation(conversation) }} />}<div className="recent-list">{recentRows.map(({ item: conversation, exiting }) => { const index = exiting ? -1 : visibleConversations.indexOf(conversation); const mark = conversationMark(conversation.id, runStates, compactionStates); return <div className={`workspace-item recent-item ${selectedConversationId === conversation.id ? 'active' : ''}${recentSearchOpen && index === recentHighlight ? ' highlighted' : ''}${mark?.kind === 'unread' ? ' unread' : ''}${exiting ? ' exiting' : ''}`} key={conversation.id}>{renamingId === conversation.id ? <RecentTitleEditor title={conversation.title} onCommit={(value) => { setRenamingId(null); onRenameConversation(conversation.id, value) }} onCancel={() => setRenamingId(null)} /> : <><button className="workspace-item-main" onClick={() => { closeRecentSearch(); void window.fastAgent.chat.markRead(conversation.id); onReadRun(conversation.id); onSelectConversation(conversation) }}><ConversationStatusMark mark={mark} /><span className="recent-copy"><ScrollingTitle className="recent-title" text={conversation.title} /><small>{<ConversationProjectTag projects={projects} projectId={conversation.projectId} />}</small></span><time>{conversation.meta}</time></button><ItemActions onDelete={() => onDeleteConversation(conversation.id)} onArchive={() => onArchiveConversation(conversation.id)} onBatch={() => onStartBatch('conversations')} onInspect={() => onInspectConversation(conversation.id)} onOpenFolder={() => onOpenConversationFolder(conversation.id)} openFolderLabel="打开会话目录" onRename={() => setRenamingId(conversation.id)} onExport={() => onExportConversation(conversation.id)} onDistill={() => onDistillSkill(conversation.id)} /></>}</div> })}{recentSearchOpen && !visibleConversations.length && <p className="sidebar-search-empty">没有匹配的对话</p>}</div><button className="recent-more" onClick={onOpenConversations}>查看全部<ChevronRight size={13} /></button></Collapse></section>
    </div>
    </div>
    {!collapsed && <div className="sidebar-resizer" onPointerDown={startResize} aria-hidden="true" />}
    <div className="sidebar-bottom side-foot"><div className="account-row"><div className="avatar">{auth.user?.display_name?.slice(0, 1) || auth.user?.username?.slice(0, 1) || 'F'}</div><div className="account-copy"><strong>{auth.user?.display_name || auth.user?.username || '账户'}</strong></div><button className="icon-button" onClick={onAccountAction} aria-label="账户菜单" title="账户菜单"><MoreHorizontal size={16} /></button></div></div>
  </aside>
})
