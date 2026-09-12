import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, ChevronDown, ChevronRight, CircleAlert, Copy, Eye, FileCode2, FileText, Folder, FolderOpen, LoaderCircle, Trash2 } from 'lucide-react'
import type { FileReference } from '../ai-response/file-reference'
import type { WorkspaceFileMatch } from '../../shared/types'
import { humanizeFileSize } from '../../shared/format'
import { flattenTreeRows, type ChildrenByPath } from './workspace-tree'
import type { ResourceTabState } from './panel-state'
import { TreeContextMenu } from './TreeContextMenu'
import { MENU_WIDTH, menuHeight, menuPosition } from './tree-menu'

const ROW_HEIGHT = 30
const OVERSCAN = 8
/** 展开后可见行数超过该值启用虚拟列表窗口渲染，避免大仓库卡顿。 */
const VIRTUAL_THRESHOLD = 200
/** 树搜索一次最多返回的候选数，与 @ 补全共用主进程遍历上限。 */
const SEARCH_LIMIT = 200

interface WorkspaceTreeProps {
  workspaceRoot: string | null
  tabState: ResourceTabState
  onTabStateChange: (patch: Partial<ResourceTabState>) => void
  onOpenFile: (reference: FileReference) => void
  onNotice: (notice: string) => void
  /** 文件被删除后通知外层：若预览正打开该文件（或所在目录），由外层关闭预览。 */
  onFileDeleted?: (path: string) => void
}

/** 右键菜单状态：目标行与弹出位置。 */
interface TreeMenuState {
  x: number
  y: number
  path: string
  name: string
  kind: 'dir' | 'file'
}

/** 目录懒加载缓存 + 展开态 → 可见行；行高固定才能做虚拟窗口。 */
export function WorkspaceTree({ workspaceRoot, tabState, onTabStateChange, onOpenFile, onNotice, onFileDeleted }: WorkspaceTreeProps) {
  const [children, setChildren] = useState<ChildrenByPath>(new Map())
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map())
  const [searchResults, setSearchResults] = useState<WorkspaceFileMatch[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [scrollTop, setScrollTop] = useState(tabState.scrollTop)
  const [viewportHeight, setViewportHeight] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadSeqRef = useRef(0)
  const scrollSaveTimer = useRef<number | null>(null)
  const refreshTimer = useRef<number | null>(null)
  const [menu, setMenu] = useState<TreeMenuState | null>(null)

  const rootName = workspaceRoot ? workspaceRoot.split(/[\\/]/).filter(Boolean).pop() || workspaceRoot : ''

  // 展开态与回调在 loadDir 里要读最新一份，又不能进它的依赖（依赖一变监听就得重挂）
  const tabStateRef = useRef(tabState)
  tabStateRef.current = tabState
  const tabChangeRef = useRef(onTabStateChange)
  tabChangeRef.current = onTabStateChange

  /** 目录已不存在：连同后代一起从缓存、展开态、选中态里摘掉，下次不再请求。 */
  const pruneMissingDir = useCallback((path: string) => {
    setChildren((current) => {
      const next = new Map(current)
      for (const key of next.keys()) if (key === path || key.startsWith(`${path}/`)) next.delete(key)
      return next
    })
    setErrors((current) => {
      if (!current.has(path)) return current
      const next = new Map(current)
      next.delete(path)
      return next
    })
    const state = tabStateRef.current
    const expanded = state.expanded.filter((item) => item !== path && !item.startsWith(`${path}/`))
    const selected = state.selected === path || state.selected?.startsWith(`${path}/`) ? null : state.selected
    if (expanded.length !== state.expanded.length || selected !== state.selected) {
      tabChangeRef.current({ expanded, selected })
    }
  }, [])

  const loadDir = useCallback(async (path: string) => {
    const seq = loadSeqRef.current
    setLoading((current) => new Set(current).add(path))
    try {
      const listing = await window.fastAgent.workspace.listDirectory(path)
      if (seq !== loadSeqRef.current) return
      // 目录已不存在：展开态是持久化的，外部删目录或切分支后会打到空处。
      // 根目录例外——整个项目没了要让用户看见，不能悄悄清空。
      if (listing.missing && path !== '') {
        pruneMissingDir(path)
        return
      }
      setChildren((current) => new Map(current).set(path, listing.entries))
      setErrors((current) => {
        if (!current.has(path)) return current
        const next = new Map(current)
        next.delete(path)
        return next
      })
    } catch (cause) {
      if (seq !== loadSeqRef.current) return
      const message = cause instanceof Error ? cause.message : '目录读取失败'
      setErrors((current) => new Map(current).set(path, message))
    } finally {
      if (seq === loadSeqRef.current) setLoading((current) => {
        const next = new Set(current)
        next.delete(path)
        return next
      })
    }
  }, [])

  // 换工作区时清空缓存并重建根目录；旧工作区的目录结果不能残留。
  useEffect(() => {
    loadSeqRef.current += 1
    setChildren(new Map())
    setErrors(new Map())
    setScrollTop(tabState.scrollTop)
    if (workspaceRoot) {
      // 恢复展开态：已展开的目录逐个懒加载。
      void loadDir('')
      for (const path of tabState.expanded) if (path !== '') void loadDir(path)
    }
  }, [workspaceRoot])

  // 工作区文件变化（agent 工具执行 / 外部 git 操作 / 窗口聚焦）后防抖重读已加载目录。
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null
      setChildren((current) => {
        for (const path of current.keys()) void loadDir(path)
        return current
      })
    }, 500)
  }, [loadDir])

  useEffect(() => {
    const offChat = window.fastAgent.chat.onEvent((event) => { if (event.type === 'tool_result') scheduleRefresh() })
    const offGit = window.fastAgent.git.onChanged(scheduleRefresh)
    const onFocus = () => scheduleRefresh()
    window.addEventListener('focus', onFocus)
    return () => {
      offChat()
      offGit()
      window.removeEventListener('focus', onFocus)
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current)
    }
  }, [scheduleRefresh])

  // 树搜索：关键字非空时切到扁平结果视图，复用 @ 补全的主进程模糊搜索。
  useEffect(() => {
    if (!workspaceRoot) return
    const keyword = tabState.search.trim()
    if (!keyword) {
      setSearchResults(null)
      return
    }
    let alive = true
    setSearchLoading(true)
    window.fastAgent.workspace.searchFiles(keyword)
      .then((results) => { if (alive) { setSearchResults(results.slice(0, SEARCH_LIMIT)); setSearchLoading(false) } })
      .catch(() => { if (alive) { setSearchResults([]); setSearchLoading(false) } })
    return () => { alive = false }
  }, [workspaceRoot, tabState.search])

  useEffect(() => () => { if (scrollSaveTimer.current !== null) window.clearTimeout(scrollSaveTimer.current) }, [])

  // 量出滚动容器高度：ResizeObserver 覆盖窗口缩放与面板拖宽。
  useEffect(() => {
    const host = scrollRef.current
    if (!host) return
    const measure = () => setViewportHeight(host.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // 恢复滚动位置：切回 Tab 时按保存值定位。
  useEffect(() => {
    if (scrollRef.current && tabState.scrollTop > 0) scrollRef.current.scrollTop = tabState.scrollTop
  }, [tabState.scrollTop])

  function toggleDir(path: string) {
    const next = new Set(tabState.expanded)
    if (next.has(path)) next.delete(path)
    else {
      next.add(path)
      void loadDir(path)
    }
    onTabStateChange({ expanded: [...next] })
  }

  function openFile(path: string) {
    onTabStateChange({ selected: path })
    onOpenFile({ path, line: null, endLine: null })
  }

  function openMenu(event: React.MouseEvent, path: string, kind: 'dir' | 'file', name: string) {
    event.preventDefault()
    event.stopPropagation()
    // 文件 5 项、目录 4 项，靠近右 / 下边缘时向内收，避免溢出窗口。
    const point = menuPosition(
      { x: event.clientX, y: event.clientY },
      { width: MENU_WIDTH, height: menuHeight(kind === 'file' ? 5 : 4) },
      { width: window.innerWidth, height: window.innerHeight }
    )
    setMenu({ ...point, path, name, kind })
  }

  async function revealInExplorer(path: string) {
    const error = await window.fastAgent.workspace.reveal(path).catch(() => '无法定位文件')
    if (error) onNotice(error)
  }

  async function copyPath(path: string) {
    try {
      // 复制绝对路径：主进程解析（空串表示根目录，同样返回根路径本身）。
      const absolute = await window.fastAgent.workspace.absolutePath(path)
      await navigator.clipboard.writeText(absolute)
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : '复制失败')
    }
  }

  function runMenuAction(action: string) {
    if (!menu) return
    const { path, kind } = menu
    setMenu(null)
    if (action === 'open') openFile(path)
    else if (action === 'toggle') toggleDir(path)
    else if (action === 'reveal') void revealInExplorer(path)
    else if (action === 'openExternal') void openWithLocalApp(path)
    else if (action === 'copy') void copyPath(path)
    else if (action === 'delete') void deleteEntry(path, kind)
  }

  /** 用系统默认应用打开文件；目录则交给资源管理器。 */
  async function openWithLocalApp(path: string) {
    const error = await window.fastAgent.workspace.openExternal(path).catch(() => '无法打开')
    if (error) onNotice(error)
  }

  /** 删除文件 / 目录：直接执行（与删除对话/项目一致，不做 confirm），成功后清理缓存并刷新父目录。 */
  async function deleteEntry(path: string, kind: 'dir' | 'file') {
    const result = await window.fastAgent.workspace.delete(path).catch(() => ({ ok: false as const, error: '删除失败' }))
    if (!result.ok) {
      onNotice(result.error || '删除失败')
      return
    }
    // 移除被删目录自身及其后代目录的缓存，父目录列表重读；选中、展开、预览状态同步清理。
    const parent = path.split('/').slice(0, -1).join('/')
    setChildren((current) => {
      const next = new Map(current)
      for (const key of next.keys()) if (key === path || key.startsWith(`${path}/`)) next.delete(key)
      return next
    })
    void loadDir(parent)
    onTabStateChange({
      selected: tabState.selected === path || (kind === 'dir' && tabState.selected !== null && tabState.selected.startsWith(`${path}/`)) ? null : tabState.selected,
      expanded: tabState.expanded.filter((item) => item !== path && !item.startsWith(`${path}/`))
    })
    onFileDeleted?.(path)
    onNotice('已删除')
  }

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
    // 滚动时收起右键菜单：fixed 定位不跟随滚动，继续显示会悬在错误位置。
    setMenu(null)
    if (scrollSaveTimer.current !== null) window.clearTimeout(scrollSaveTimer.current)
    scrollSaveTimer.current = window.setTimeout(() => onTabStateChange({ scrollTop: el.scrollTop }), 250)
  }

  const expandedSet = useMemo(() => new Set(tabState.expanded), [tabState.expanded])
  // 根折叠时不渲染子行：flattenTreeRows 只按目录展开集展开，根自身的展开态在这里拦截。
  const rows = useMemo(() => expandedSet.has('') ? flattenTreeRows(children, expandedSet) : [], [children, expandedSet])
  const virtualize = rows.length > VIRTUAL_THRESHOLD
  const total = rows.length
  const start = virtualize ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0
  const end = virtualize ? Math.min(total, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN) : total
  const visibleRows = rows.slice(start, end)

  if (!workspaceRoot) {
    return <div className="resource-empty"><FileText size={23} /><strong>未打开工作区</strong><span>打开项目后这里会展示文件树。</span></div>
  }

  const searching = Boolean(tabState.search.trim())

  return (
    <>
    <div className="resource-scroll" ref={scrollRef} onScroll={onScroll}>
      {searching ? (
        <>
          {/* 搜索视图：根节点 + 匹配结果扁平列表 */}
          {searchLoading
            ? <div className="resource-empty compact"><LoaderCircle size={18} className="spin" /><span>正在搜索…</span></div>
            : searchResults && searchResults.length === 0
              ? <div className="resource-empty compact"><CircleAlert size={18} /><span>没有匹配的文件</span></div>
              : searchResults?.map((match) => <SearchRow key={match.path} match={match} selected={tabState.selected === match.path} onOpen={() => openFile(match.path)} onContextMenu={(event) => openMenu(event, match.path, match.isDirectory ? 'dir' : 'file', match.name)} />)}
        </>
      ) : (
        <>
          {/* 根节点行：始终在最前，显示工作区名 */}
          <button type="button" className={`tree-row root ${expandedSet.has('') ? 'open' : ''}`} style={{ paddingLeft: 8 }} onClick={() => toggleDir('')} title={workspaceRoot} onContextMenu={(event) => openMenu(event, '', 'dir', rootName)}>
            <ChevronRight size={14} className="tree-chevron" />
            {expandedSet.has('') ? <FolderOpen size={14} className="tree-folder-icon" /> : <Folder size={14} className="tree-folder-icon" />}
            <span className="tree-name">{rootName}</span>
            {loading.has('') && <LoaderCircle size={12} className="spin tree-meta" />}
          </button>
          {/* 虚拟列表：上下 spacer 撑出全文高度，只渲染可视窗口；translateY 补偿滚动容器上 padding */}
          <div style={{ height: virtualize ? total * ROW_HEIGHT : 'auto', position: 'relative' }}>
            <div style={virtualize ? { transform: `translateY(${6 + start * ROW_HEIGHT}px)` } : undefined}>
              {visibleRows.map((row) => (
                <TreeRow
                  key={row.path}
                  row={row}
                  expanded={expandedSet.has(row.path)}
                  loading={loading.has(row.path)}
                  error={errors.get(row.path)}
                  selected={tabState.selected === row.path}
                  onToggle={() => toggleDir(row.path)}
                  onOpen={() => openFile(row.path)}
                  onContextMenu={(event) => openMenu(event, row.path, row.kind, row.name)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
    {menu && (
      <TreeContextMenu x={menu.x} y={menu.y} onDismiss={() => setMenu(null)}>
        {menu.kind === 'file'
          ? <button role="menuitem" onClick={() => runMenuAction('open')}><Eye size={14} />打开预览</button>
          : <button role="menuitem" onClick={() => runMenuAction('toggle')}>{expandedSet.has(menu.path) ? <><ChevronDown size={14} />折叠目录</> : <><ChevronRight size={14} />展开目录</>}</button>}
        {menu.kind === 'file' && <button role="menuitem" onClick={() => runMenuAction('openExternal')}><AppWindow size={14} />用本地应用打开</button>}
        <button role="menuitem" onClick={() => runMenuAction('reveal')}><FolderOpen size={14} />在资源管理器中显示</button>
        <button role="menuitem" onClick={() => runMenuAction('copy')}><Copy size={14} />复制绝对路径</button>
        <div className="tree-context-separator" />
        <button role="menuitem" className="danger" onClick={() => runMenuAction('delete')}><Trash2 size={14} />删除{menu.kind === 'dir' ? '目录' : '文件'}</button>
      </TreeContextMenu>
    )}
    </>
  )
}

function TreeRow({ row, expanded, loading, error, selected, onToggle, onOpen, onContextMenu }: {
  row: { path: string; name: string; kind: 'dir' | 'file'; depth: number; size?: number; fileType?: string }
  expanded: boolean
  loading: boolean
  error: string | undefined
  selected: boolean
  onToggle: () => void
  onOpen: () => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const indent = 8 + row.depth * 14
  if (row.kind === 'dir') {
    return (
      <button type="button" className={`tree-row dir ${expanded ? 'open' : ''} ${selected ? 'active' : ''}`} style={{ paddingLeft: indent }} onClick={onToggle} title={row.path} onContextMenu={onContextMenu}>
        <ChevronRight size={14} className="tree-chevron" />
        {expanded ? <FolderOpen size={14} className="tree-folder-icon" /> : <Folder size={14} className="tree-folder-icon" />}
        <span className="tree-name">{row.name}</span>
        {loading && <LoaderCircle size={12} className="spin tree-meta" />}
        {error && <span className="tree-meta tree-error" title={error}><CircleAlert size={12} /></span>}
      </button>
    )
  }
  return (
    <button type="button" className={`tree-row file ${selected ? 'active' : ''}`} style={{ paddingLeft: indent + 22 }} onClick={onOpen} title={row.path} onContextMenu={onContextMenu}>
      <FileCode2 size={14} className="tree-file-icon" />
      <span className="tree-name">{row.name}</span>
      <span className="tree-meta tree-type">{row.fileType ?? 'txt'}</span>
      <span className="tree-meta tree-size">{humanizeFileSize(row.size)}</span>
    </button>
  )
}

function SearchRow({ match, selected, onOpen, onContextMenu }: { match: WorkspaceFileMatch; selected: boolean; onOpen: () => void; onContextMenu: (event: React.MouseEvent) => void }) {
  const indent = 8 + (match.path.split('/').length - 1) * 14
  return (
    <button type="button" className={`tree-row file ${selected ? 'active' : ''}`} style={{ paddingLeft: indent }} onClick={onOpen} title={match.path} onContextMenu={onContextMenu}>
      {match.isDirectory ? <Folder size={14} className="tree-folder-icon" /> : <FileCode2 size={14} className="tree-file-icon" />}
      <span className="tree-name">{match.path}</span>
      {!match.isDirectory && <span className="tree-meta tree-size">{humanizeFileSize(match.size)}</span>}
    </button>
  )
}
