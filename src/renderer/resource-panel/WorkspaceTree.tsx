import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppWindow, ChevronDown, ChevronRight, CircleAlert, Copy, Eye, FileCode2, FileText, Folder, FolderOpen, LoaderCircle, MessageSquarePlus, Trash2, X } from 'lucide-react'
import type { FileReference } from '../ai-response/file-reference'
import type { WorkspaceFileMatch } from '../../shared/types'
import { humanizeFileSize } from '../../shared/format'
import { flattenTreeRows, type ChildrenByPath, type TreeRow as TreeRowData } from './workspace-tree'
import type { ResourceTabState } from './panel-state'
import { TreeContextMenu } from './TreeContextMenu'
import { MENU_WIDTH, menuHeight, menuPosition } from './tree-menu'
import { selectionMentionText, selectionSummary, topLevelSelection, type TreeSelectionItem } from './tree-selection'
import { canDropInto, dropDirFor, parentPath, remapMovedPath } from './tree-drag'
import { useTreeSelection } from './use-tree-selection'
import { TreeSelectionBar } from './TreeSelectionBar'
import { Collapse } from '../Collapse'
import { ConfirmDialog } from '../components/ConfirmDialog'

const ROW_HEIGHT = 30
const OVERSCAN = 8
/** 展开后可见行数超过该值启用虚拟列表窗口渲染，避免大仓库卡顿。 */
const VIRTUAL_THRESHOLD = 200
/** 树搜索一次最多返回的候选数，与 @ 补全共用主进程遍历上限。 */
const SEARCH_LIMIT = 200
/** 拖着文件悬停在折叠目录上这么久就自动展开，方便往深层目录里放。 */
const DRAG_EXPAND_DELAY = 600
/** 拖放数据的 MIME：只认本树发起的拖动，外部拖进来的文件不走这条路。 */
const TREE_DRAG_TYPE = 'application/x-fastagent-tree'

interface WorkspaceTreeProps {
  workspaceRoot: string | null
  conversationId: string | null
  tabState: ResourceTabState
  onTabStateChange: (patch: Partial<ResourceTabState>) => void
  onOpenFile: (reference: FileReference) => void
  onNotice: (notice: string) => void
  /** 文件被删除后通知外层：若预览正打开该文件（或所在目录），由外层关闭预览。 */
  onFileDeleted?: (path: string) => void
  /** 文件被移动后通知外层：预览正打开它时跟到新位置。 */
  onFileMoved?: (from: string, to: string) => void
  /** 把选中的文件 / 目录作为引用追加进输入框。 */
  onAddToChat?: (text: string) => void
}

/** 右键菜单状态：目标行与弹出位置。 */
interface TreeMenuState {
  x: number
  y: number
  path: string
  name: string
  kind: 'dir' | 'file'
  /** 在多选集合里的项上右键：菜单作用于整批选中项。 */
  batch?: boolean
}

/** 行上的拖放回调：左键按住拖动移动文件 / 目录，目录行（及文件行所在目录）是落点。 */
interface RowDragHandlers {
  onDragStart: (event: React.DragEvent) => void
  onDragOver: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
  onDragEnd: () => void
}

/** 目录懒加载缓存 + 展开态 → 可见行；行高固定才能做虚拟窗口。 */
export function WorkspaceTree({ workspaceRoot, conversationId, tabState, onTabStateChange, onOpenFile, onNotice, onFileDeleted, onFileMoved, onAddToChat }: WorkspaceTreeProps) {
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
  const [pendingDelete, setPendingDelete] = useState<TreeSelectionItem[] | null>(null)
  const selection = useTreeSelection(scrollRef, tabState.selected)
  const multi = selection.selection
  // 拖动中的项放 ref：dragover 每秒触发几十次，读 state 会拿到旧值，也不值得为它重渲染。
  const dragItemsRef = useRef<TreeSelectionItem[] | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const expandTimer = useRef<{ path: string; timer: number } | null>(null)

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
    selection.clear()
    setScrollTop(tabState.scrollTop)
    if (workspaceRoot) {
      // 恢复展开态：已展开的目录逐个懒加载。
      void loadDir('')
      for (const path of tabState.expanded) if (path !== '') void loadDir(path)
    }
  }, [workspaceRoot, conversationId])

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

  useEffect(() => () => {
    if (scrollSaveTimer.current !== null) window.clearTimeout(scrollSaveTimer.current)
    if (expandTimer.current) window.clearTimeout(expandTimer.current.timer)
  }, [])

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
    // 在已选中的一批里右键：菜单作用于整批；在批外右键就回到单项菜单，并放弃之前的多选。
    const batch = multi.length > 1 && selection.paths.has(path)
    if (!batch && multi.length) selection.clear()
    // 单项：文件 5 项、目录 4 项（可添加到对话时各多 1 项）；批量 4 或 5 项。靠近右 / 下边缘时向内收，避免溢出窗口。
    const items = (batch ? 4 : kind === 'file' ? 5 : 4) + (onAddToChat ? 1 : 0)
    const point = menuPosition(
      { x: event.clientX, y: event.clientY },
      { width: MENU_WIDTH, height: menuHeight(items) },
      { width: window.innerWidth, height: window.innerHeight }
    )
    setMenu({ ...point, path, name, kind, batch })
  }

  function addSelectionToChat(items: TreeSelectionItem[]) {
    if (!onAddToChat || !items.length) return
    onAddToChat(selectionMentionText(items))
    selection.clear()
  }

  async function copySelectionPaths(items: TreeSelectionItem[]) {
    try {
      const paths = await Promise.all(items.map((entry) => window.fastAgent.workspace.absolutePath(entry.path)))
      await navigator.clipboard.writeText(paths.join('\n'))
      onNotice(`已复制 ${paths.length} 条路径`)
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : '复制失败')
    }
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
    if (menu.batch) {
      if (action === 'addToChat') addSelectionToChat(multi)
      else if (action === 'copy') void copySelectionPaths(multi)
      else if (action === 'delete') setPendingDelete(topLevelSelection(multi))
      else if (action === 'clear') selection.clear()
      return
    }
    if (action === 'addToChat') addSelectionToChat([{ path, kind }])
    else if (action === 'open') openFile(path)
    else if (action === 'toggle') toggleDir(path)
    else if (action === 'reveal') void revealInExplorer(path)
    else if (action === 'openExternal') void openWithLocalApp(path)
    else if (action === 'copy') void copyPath(path)
    else if (action === 'delete') void deleteEntries([{ path, kind }])
  }

  /** 用系统默认应用打开文件；目录则交给资源管理器。 */
  async function openWithLocalApp(path: string) {
    const error = await window.fastAgent.workspace.openExternal(path).catch(() => '无法打开')
    if (error) onNotice(error)
  }

  /**
   * 逐个删除，成功的清理缓存并刷新父目录；失败的不影响其余项。
   * 单项删除直接执行（与删除对话/项目一致，不做 confirm）；批量删除由调用方先确认，
   * 并已按 topLevelSelection 去掉被祖先目录覆盖的后代。
   */
  async function deleteEntries(items: TreeSelectionItem[]) {
    const deleted: TreeSelectionItem[] = []
    const failures: string[] = []
    for (const item of items) {
      const result = await window.fastAgent.workspace.delete(item.path).catch(() => ({ ok: false as const, error: '删除失败' }))
      if (result.ok) deleted.push(item)
      else failures.push(items.length === 1 ? result.error || '删除失败' : `${item.path}（${result.error || '删除失败'}）`)
    }
    if (deleted.length) {
      const covers = (target: string) => deleted.some((item) => target === item.path || target.startsWith(`${item.path}/`))
      // 移除被删目录自身及其后代目录的缓存，父目录列表重读；选中、展开、多选、预览状态同步清理。
      setChildren((current) => {
        const next = new Map(current)
        for (const key of next.keys()) if (covers(key)) next.delete(key)
        return next
      })
      for (const parent of new Set(deleted.map((item) => parentPath(item.path)))) void loadDir(parent)
      onTabStateChange({
        selected: tabState.selected !== null && covers(tabState.selected) ? null : tabState.selected,
        expanded: tabState.expanded.filter((item) => !covers(item))
      })
      selection.setSelection((current) => current.filter((entry) => !covers(entry.path)))
      for (const item of deleted) onFileDeleted?.(item.path)
    }
    if (!failures.length) onNotice(items.length === 1 ? '已删除' : `已删除 ${deleted.length} 项`)
    else if (items.length === 1) onNotice(failures[0])
    else onNotice(`已删除 ${deleted.length} 项，${failures.length} 项失败：${failures.slice(0, 2).join('、')}${failures.length > 2 ? ' 等' : ''}`)
  }

  /**
   * 拖放移动：主进程逐项移动（不覆盖同名、不进自身子目录），成功的改写缓存、展开态、选中态与多选，
   * 目标目录展开以便看到移进去的东西。
   */
  async function moveEntries(items: TreeSelectionItem[], target: string) {
    const results = await window.fastAgent.workspace.move(items.map((item) => item.path), target).catch(() => null)
    if (!results) {
      onNotice('移动失败')
      return
    }
    const moves = results.flatMap((result) => result.ok ? [{ from: result.from, to: result.to }] : [])
    const failures = results.flatMap((result) => result.ok ? [] : [result.error])
    if (moves.length) {
      const moved = (key: string) => moves.some((move) => key === move.from || key.startsWith(`${move.from}/`))
      setChildren((current) => {
        const next = new Map(current)
        for (const key of next.keys()) if (moved(key)) next.delete(key)
        return next
      })
      const remapped = tabState.expanded.map((path) => remapMovedPath(path, moves))
      const expanded = [...new Set([...remapped, target])]
      // 重读：目标目录、各源的父目录，以及随之换了路径的已展开目录
      const reload = new Set([target, ...moves.map((move) => parentPath(move.from)), ...remapped.filter((path, index) => path !== tabState.expanded[index])])
      for (const path of reload) void loadDir(path)
      onTabStateChange({ expanded, selected: tabState.selected === null ? null : remapMovedPath(tabState.selected, moves) })
      // 移动后的项保持选中，接着还能再拖一次或做别的批量操作。
      selection.setSelection(moves.map((move) => ({ path: move.to, kind: items.find((item) => item.path === move.from)?.kind ?? 'file' })))
      for (const move of moves) onFileMoved?.(move.from, move.to)
    }
    const targetName = target ? target.split('/').pop() : rootName
    if (!failures.length) onNotice(`已移动 ${moves.length} 项到 ${targetName}`)
    else if (!moves.length) onNotice(failures.length === 1 ? failures[0] : `${failures.length} 项未移动：${failures.slice(0, 2).join('、')}${failures.length > 2 ? ' 等' : ''}`)
    else onNotice(`已移动 ${moves.length} 项，${failures.length} 项未移动：${failures.slice(0, 2).join('、')}${failures.length > 2 ? ' 等' : ''}`)
  }

  function endDrag() {
    dragItemsRef.current = null
    setDropTarget(null)
    if (expandTimer.current) {
      window.clearTimeout(expandTimer.current.timer)
      expandTimer.current = null
    }
  }

  /** 左键按住行拖动：拖的是选中项之一就整批一起拖，否则只拖这一项。 */
  function dragHandlers(item: TreeSelectionItem): RowDragHandlers {
    return {
      onDragStart: (event) => {
        if (item.path === '') { event.preventDefault(); return }
        const items = selection.paths.has(item.path) ? topLevelSelection(multi) : [item]
        if (!selection.paths.has(item.path) && multi.length) selection.clear()
        dragItemsRef.current = items
        setMenu(null)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(TREE_DRAG_TYPE, JSON.stringify(items.map((entry) => entry.path)))
        if (items.length > 1) {
          // 多项时换成「移动 N 项」的拖影，默认拖影只画出按住的那一行，看不出拖了几个。
          const ghost = document.createElement('div')
          ghost.className = 'tree-drag-ghost'
          ghost.textContent = `移动 ${items.length} 项`
          document.body.appendChild(ghost)
          event.dataTransfer.setDragImage(ghost, 12, 12)
          window.setTimeout(() => ghost.remove(), 0)
        }
      },
      onDragOver: (event) => {
        const items = dragItemsRef.current
        if (!items) return
        const target = dropDirFor(item)
        // 不 preventDefault 就是「这里不能放」，光标显示禁止符号
        if (!canDropInto(items, target)) {
          if (dropTarget !== null) setDropTarget(null)
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        if (dropTarget !== target) setDropTarget(target)
        if (item.kind === 'dir' && item.path !== '' && !expandedSet.has(item.path) && expandTimer.current?.path !== item.path) {
          if (expandTimer.current) window.clearTimeout(expandTimer.current.timer)
          expandTimer.current = { path: item.path, timer: window.setTimeout(() => { expandTimer.current = null; toggleDir(item.path) }, DRAG_EXPAND_DELAY) }
        }
      },
      onDrop: (event) => {
        event.preventDefault()
        const items = dragItemsRef.current
        const target = dropDirFor(item)
        endDrag()
        if (items && canDropInto(items, target)) void moveEntries(items, target)
      },
      onDragEnd: endDrag
    }
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
  const rootItem: TreeSelectionItem = { path: '', kind: 'dir' }
  const treeOrder = useMemo<TreeSelectionItem[]>(() => [{ path: '', kind: 'dir' }, ...rows.map((row) => ({ path: row.path, kind: row.kind }))], [rows])
  const searchOrder = useMemo<TreeSelectionItem[]>(() => (searchResults ?? []).map((match) => ({ path: match.path, kind: match.isDirectory ? 'dir' as const : 'file' as const })), [searchResults])

  const renderRow = (row: TreeRowData) => {
    const item: TreeSelectionItem = { path: row.path, kind: row.kind }
    return <TreeRow
      key={row.path}
      row={row}
      expanded={expandedSet.has(row.path)}
      loading={loading.has(row.path)}
      error={errors.get(row.path)}
      selected={tabState.selected === row.path}
      checked={selection.paths.has(row.path)}
      dropTarget={dropTarget === row.path}
      drag={dragHandlers(item)}
      onClick={(event) => selection.handleRowClick(event, item, treeOrder, () => row.kind === 'dir' ? toggleDir(row.path) : openFile(row.path))}
      onContextMenu={(event) => openMenu(event, row.path, row.kind, row.name)}
    />
  }

  /**
   * 非虚拟模式按目录嵌套渲染，每个目录的子树包一层 Collapse：展开折叠与对话执行过程同一套动画。
   * 虚拟模式（可见行过多）只能扁平渲染，不做动画。
   */
  const renderBranch = (path: string, depth: number): ReactNode => {
    const entries = children.get(path)
    if (!entries) return null
    return entries.map((entry) => {
      const row: TreeRowData = { path: entry.path, name: entry.name, kind: entry.kind, depth, size: entry.size, fileType: entry.fileType }
      if (entry.kind !== 'dir') return renderRow(row)
      return <Fragment key={entry.path}>
        {renderRow(row)}
        <Collapse open={expandedSet.has(entry.path)} appear={false}>{renderBranch(entry.path, depth + 1)}</Collapse>
      </Fragment>
    })
  }

  if (!workspaceRoot) {
    return <div className="resource-empty"><FileText size={23} /><strong>未打开工作区</strong><span>打开项目后这里会展示文件树。</span></div>
  }

  const searching = Boolean(tabState.search.trim())
  const rootDrag = dragHandlers(rootItem)

  return (
    <>
    <div
      className="resource-scroll tree-scroll"
      ref={scrollRef}
      onScroll={onScroll}
      onKeyDown={selection.onKeyDown}
      onMouseDown={selection.onScrollMouseDown}
      // 拖出树外时撤掉落点高亮；在树内移动时 dragover 会马上补回来
      onDragLeave={(event) => { if (!scrollRef.current?.contains(event.relatedTarget as Node | null)) setDropTarget(null) }}
    >
      {searching ? (
        <>
          {/* 搜索视图：根节点 + 匹配结果扁平列表 */}
          {searchLoading
            ? <div className="resource-empty compact"><LoaderCircle size={18} className="spin" /><span>正在搜索…</span></div>
            : searchResults && searchResults.length === 0
              ? <div className="resource-empty compact"><CircleAlert size={18} /><span>没有匹配的文件</span></div>
              : searchResults?.map((match) => {
                const item: TreeSelectionItem = { path: match.path, kind: match.isDirectory ? 'dir' : 'file' }
                return <SearchRow key={match.path} match={match} selected={tabState.selected === match.path} checked={selection.paths.has(match.path)} dropTarget={dropTarget === match.path} drag={dragHandlers(item)} onClick={(event) => selection.handleRowClick(event, item, searchOrder, () => openFile(match.path))} onContextMenu={(event) => openMenu(event, match.path, item.kind, match.name)} />
              })}
        </>
      ) : (
        <>
          {/* 根节点行：始终在最前，显示工作区名；可作为拖放落点（移回根目录），自身不能拖 */}
          <button type="button" className={`tree-row root ${expandedSet.has('') ? 'open' : ''} ${dropTarget === '' ? 'drop-target' : ''}`} style={{ paddingLeft: 8 }} data-tree-path="" data-tree-kind="dir"
            onClick={(event) => selection.handleRowClick(event, rootItem, treeOrder, () => toggleDir(''))} title={workspaceRoot} onContextMenu={(event) => openMenu(event, '', 'dir', rootName)}
            onDragOver={rootDrag.onDragOver} onDrop={rootDrag.onDrop}>
            <ChevronRight size={14} className="tree-chevron" />
            {expandedSet.has('') ? <FolderOpen size={14} className="tree-folder-icon" /> : <Folder size={14} className="tree-folder-icon" />}
            <span className="tree-name">{rootName}</span>
            {loading.has('') && <LoaderCircle size={12} className="spin tree-meta" />}
          </button>
          {virtualize ? (
            /* 虚拟列表：上下 spacer 撑出全文高度，只渲染可视窗口；translateY 补偿滚动容器上 padding */
            <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
              <div style={{ transform: `translateY(${6 + start * ROW_HEIGHT}px)` }}>
                {visibleRows.map(renderRow)}
              </div>
            </div>
          ) : <Collapse open={expandedSet.has('')} appear={false}>{renderBranch('', 0)}</Collapse>}
        </>
      )}
      {selection.marquee && <div className="tree-marquee" style={{ top: selection.marquee.top, height: selection.marquee.height }} aria-hidden="true" />}
    </div>
    {multi.length > 0 && (
      <TreeSelectionBar count={multi.length} summary={selectionSummary(multi)} onClear={selection.clear}>
        {onAddToChat && <button type="button" onClick={() => addSelectionToChat(multi)} title="作为引用添加到输入框"><MessageSquarePlus size={13} />添加到对话</button>}
        <button type="button" onClick={() => void copySelectionPaths(multi)} title="复制全部绝对路径"><Copy size={13} />复制路径</button>
        <button type="button" className="danger" onClick={() => setPendingDelete(topLevelSelection(multi))} title="删除选中项"><Trash2 size={13} />删除</button>
      </TreeSelectionBar>
    )}
    {pendingDelete && (
      <ConfirmDialog
        title={`删除选中的 ${pendingDelete.length} 项？`}
        lines={[
          `${selectionSummary(pendingDelete)}会从磁盘上删除，目录连同其中的全部内容一起删除。`,
          ...pendingDelete.slice(0, 5).map((entry) => `· ${entry.path}${entry.kind === 'dir' ? '/' : ''}`),
          ...(pendingDelete.length > 5 ? [`· 以及另外 ${pendingDelete.length - 5} 项`] : [])
        ]}
        confirmLabel="删除"
        danger
        onConfirm={() => { const items = pendingDelete; setPendingDelete(null); void deleteEntries(items) }}
        onCancel={() => setPendingDelete(null)}
      />
    )}
    {menu && menu.batch && (
      <TreeContextMenu x={menu.x} y={menu.y} onDismiss={() => setMenu(null)}>
        {onAddToChat && <button role="menuitem" onClick={() => runMenuAction('addToChat')}><MessageSquarePlus size={14} />添加 {multi.length} 项到对话</button>}
        <button role="menuitem" onClick={() => runMenuAction('copy')}><Copy size={14} />复制 {multi.length} 条绝对路径</button>
        <button role="menuitem" onClick={() => runMenuAction('clear')}><X size={14} />取消选择</button>
        <div className="tree-context-separator" />
        <button role="menuitem" className="danger" onClick={() => runMenuAction('delete')}><Trash2 size={14} />删除选中的 {multi.length} 项</button>
      </TreeContextMenu>
    )}
    {menu && !menu.batch && (
      <TreeContextMenu x={menu.x} y={menu.y} onDismiss={() => setMenu(null)}>
        {menu.kind === 'file'
          ? <button role="menuitem" onClick={() => runMenuAction('open')}><Eye size={14} />打开预览</button>
          : <button role="menuitem" onClick={() => runMenuAction('toggle')}>{expandedSet.has(menu.path) ? <><ChevronDown size={14} />折叠目录</> : <><ChevronRight size={14} />展开目录</>}</button>}
        {menu.kind === 'file' && <button role="menuitem" onClick={() => runMenuAction('openExternal')}><AppWindow size={14} />用本地应用打开</button>}
        <button role="menuitem" onClick={() => runMenuAction('reveal')}><FolderOpen size={14} />在资源管理器中显示</button>
        <button role="menuitem" onClick={() => runMenuAction('copy')}><Copy size={14} />复制绝对路径</button>
        {onAddToChat && menu.path !== '' && <button role="menuitem" onClick={() => runMenuAction('addToChat')}><MessageSquarePlus size={14} />添加到对话</button>}
        <div className="tree-context-separator" />
        <button role="menuitem" className="danger" onClick={() => runMenuAction('delete')}><Trash2 size={14} />删除{menu.kind === 'dir' ? '目录' : '文件'}</button>
      </TreeContextMenu>
    )}
    </>
  )
}

function TreeRow({ row, expanded, loading, error, selected, checked, dropTarget, drag, onClick, onContextMenu }: {
  row: TreeRowData
  expanded: boolean
  loading: boolean
  error: string | undefined
  selected: boolean
  /** 在多选集合里。 */
  checked: boolean
  /** 拖放时当前落点就是这个目录。 */
  dropTarget: boolean
  drag: RowDragHandlers
  onClick: (event: React.MouseEvent) => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const indent = 8 + row.depth * 14
  const common = {
    type: 'button' as const,
    title: row.path,
    draggable: true,
    'data-tree-path': row.path,
    'data-tree-kind': row.kind,
    'aria-pressed': checked || undefined,
    onClick,
    onContextMenu,
    ...drag
  }
  if (row.kind === 'dir') {
    return (
      <button {...common} className={`tree-row dir ${expanded ? 'open' : ''} ${selected ? 'active' : ''} ${checked ? 'checked' : ''} ${dropTarget ? 'drop-target' : ''}`} style={{ paddingLeft: indent }}>
        <ChevronRight size={14} className="tree-chevron" />
        {expanded ? <FolderOpen size={14} className="tree-folder-icon" /> : <Folder size={14} className="tree-folder-icon" />}
        <span className="tree-name">{row.name}</span>
        {loading && <LoaderCircle size={12} className="spin tree-meta" />}
        {error && <span className="tree-meta tree-error" title={error}><CircleAlert size={12} /></span>}
      </button>
    )
  }
  return (
    <button {...common} className={`tree-row file ${selected ? 'active' : ''} ${checked ? 'checked' : ''}`} style={{ paddingLeft: indent + 22 }}>
      <FileCode2 size={14} className="tree-file-icon" />
      <span className="tree-name">{row.name}</span>
      <span className="tree-meta tree-type">{row.fileType ?? 'txt'}</span>
      <span className="tree-meta tree-size">{humanizeFileSize(row.size)}</span>
    </button>
  )
}

function SearchRow({ match, selected, checked, dropTarget, drag, onClick, onContextMenu }: { match: WorkspaceFileMatch; selected: boolean; checked: boolean; dropTarget: boolean; drag: RowDragHandlers; onClick: (event: React.MouseEvent) => void; onContextMenu: (event: React.MouseEvent) => void }) {
  const indent = 8 + (match.path.split('/').length - 1) * 14
  return (
    <button type="button" className={`tree-row file ${selected ? 'active' : ''} ${checked ? 'checked' : ''} ${dropTarget ? 'drop-target' : ''}`} style={{ paddingLeft: indent }} title={match.path}
      draggable data-tree-path={match.path} data-tree-kind={match.isDirectory ? 'dir' : 'file'} aria-pressed={checked || undefined} onClick={onClick} onContextMenu={onContextMenu} {...drag}>
      {match.isDirectory ? <Folder size={14} className="tree-folder-icon" /> : <FileCode2 size={14} className="tree-file-icon" />}
      <span className="tree-name">{match.path}</span>
      {!match.isDirectory && <span className="tree-meta tree-size">{humanizeFileSize(match.size)}</span>}
    </button>
  )
}
