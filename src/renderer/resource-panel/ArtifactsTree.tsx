import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, ChevronDown, ChevronRight, CircleAlert, Copy, Eye, FileCode2, FileText, FileX2, Folder, FolderOpen, Globe, History, LoaderCircle, MessageSquarePlus, PenLine, Trash2, X } from 'lucide-react'
import type { Artifact, ArtifactGroup } from '../../shared/types'
import type { FileReference } from '../ai-response/file-reference'
import { buildArtifactGroups } from '../../shared/artifact'
import { humanizeFileSize } from '../../shared/format'
import { ARTIFACT_TYPE_LABEL, filterArtifactGroups } from './artifacts-tree'
import type { ResourceTabState } from './panel-state'
import { ArtifactVersions } from './ArtifactVersions'
import { continueEditPrompt } from './artifact-versions'
import { TreeContextMenu } from './TreeContextMenu'
import { MENU_WIDTH, menuHeight, menuPosition } from './tree-menu'
import { Collapse } from '../Collapse'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useTreeSelection } from './use-tree-selection'
import { TreeSelectionBar } from './TreeSelectionBar'
import type { TreeSelectionItem } from './tree-selection'

interface ArtifactsTreeProps {
  workspaceRoot: string | null
  /** 当前会话：它的产物组置顶并默认展开。 */
  conversationId: string | null
  tabState: ResourceTabState
  onTabStateChange: (patch: Partial<ResourceTabState>) => void
  onOpenFile: (reference: FileReference) => void
  onNotice: (notice: string) => void
  /** 删掉的文件正被预览时由外层关闭预览。 */
  onFileDeleted?: (path: string) => void
  /** 「继续修改」：把提示写进输入框，由用户补充要求后自己发。 */
  onContinueEdit?: (text: string) => void
  /** 把选中产物的路径作为引用追加进输入框。 */
  onAddToChat?: (text: string) => void
}

/** 右键菜单目标：产物条目或它所属的任务组。 */
type ArtifactMenuTarget =
  | { kind: 'artifact'; artifact: Artifact }
  | { kind: 'group'; group: ArtifactGroup }
  | { kind: 'batch' }

type ArtifactMenuState = ArtifactMenuTarget & { x: number; y: number }

/** Artifact 面板：Agent 写文件成功后由主进程登记，这里按会话分组展示并实时刷新。 */
export function ArtifactsTree({ workspaceRoot, conversationId, tabState, onTabStateChange, onOpenFile, onNotice, onFileDeleted, onContinueEdit, onAddToChat }: ArtifactsTreeProps) {
  const [menu, setMenu] = useState<ArtifactMenuState | null>(null)
  // 版本视图占满整个面板：diff 需要宽度，挤在树里读不了。
  const [versionsFor, setVersionsFor] = useState<Artifact | null>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [conversationTitles, setConversationTitles] = useState<ReadonlyMap<string, string>>(new Map())
  const scrollRef = useRef<HTMLDivElement>(null)
  // 展开态的默认值只在会话切换时写一次，读的必须是最新一份，不能把 tabState 挂进依赖里
  const tabStateRef = useRef(tabState)
  tabStateRef.current = tabState
  const scrollSaveTimer = useRef<number | null>(null)
  const requestSeq = useRef(0)
  // 与 Workspace 同一套多选：选择键是产物 id（同一路径可能被不同会话各登记一条）。
  const selection = useTreeSelection(scrollRef, tabState.selected)
  const [pendingDelete, setPendingDelete] = useState<Artifact[] | null>(null)

  // 会话标题 → 任务组名：组名优先级「会话标题」在分组逻辑里通过该回调注入。
  // 只在挂载时拉一次不够：刚建的会话查不到标题，组名会回落成工具名，
  // 所以产物里出现没见过的会话 id 时补拉一次。
  const unknownConversation = artifacts.some((artifact) => artifact.conversationId && !conversationTitles.has(artifact.conversationId))
  useEffect(() => {
    if (conversationTitles.size > 0 && !unknownConversation) return
    let alive = true
    window.fastAgent.conversations.list()
      .then((records) => { if (alive) setConversationTitles(new Map(records.map((record) => [record.id, record.title]))) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [unknownConversation, conversationTitles.size])

  const load = useCallback(() => {
    if (!workspaceRoot) {
      setArtifacts([])
      return
    }
    const seq = ++requestSeq.current
    setLoading(true)
    setError('')
    window.fastAgent.artifacts.list({ workspaceId: workspaceRoot })
      .then((items) => { if (seq === requestSeq.current) { setArtifacts(items); setLoading(false) } })
      .catch((cause: unknown) => { if (seq === requestSeq.current) { setError(cause instanceof Error ? cause.message : 'Artifact 列表加载失败'); setLoading(false) } })
  }, [workspaceRoot])

  // 打开面板或工作区变化时拉一次；Agent 产生新 Artifact 时主进程广播，这里静默重拉。
  useEffect(() => {
    load()
    const off = window.fastAgent.artifacts.onChanged(() => load())
    return () => { off(); requestSeq.current += 1 }
  }, [load])

  // 恢复滚动位置。
  useEffect(() => {
    if (scrollRef.current && tabState.scrollTop > 0) scrollRef.current.scrollTop = tabState.scrollTop
  }, [tabState.scrollTop])

  useEffect(() => () => { if (scrollSaveTimer.current !== null) window.clearTimeout(scrollSaveTimer.current) }, [])

  // 当前会话的产物组默认展开：只在会话切换时写一次，之后用户手动折叠不会被反复顶开。
  const expandedConversation = useRef<string | null>(null)
  useEffect(() => {
    if (!conversationId || expandedConversation.current === conversationId) return
    expandedConversation.current = conversationId
    if (!tabStateRef.current.expanded.includes(conversationId)) {
      onTabStateChange({ expanded: [...tabStateRef.current.expanded, conversationId] })
    }
  }, [conversationId, onTabStateChange])

  const groups = useMemo(
    () => buildArtifactGroups(artifacts, { titleForConversation: (id) => conversationTitles.get(id) ?? null, pinnedConversationId: conversationId }),
    [artifacts, conversationTitles, conversationId]
  )
  const visibleGroups = useMemo(() => filterArtifactGroups(groups, tabState.search), [groups, tabState.search])
  const expandedSet = useMemo(() => new Set(tabState.expanded), [tabState.expanded])
  const totalItems = visibleGroups.reduce((sum, group) => sum + group.count, 0)
  // 范围选择的可见顺序：只含展开组里的产物，组行本身不参与多选。
  const order = useMemo<TreeSelectionItem[]>(() => visibleGroups
    .filter((group) => expandedSet.has(group.id))
    .flatMap((group) => group.artifacts.map((artifact) => ({ path: artifact.id, kind: 'file' as const }))), [visibleGroups, expandedSet])
  const byId = useMemo(() => new Map(artifacts.map((artifact) => [artifact.id, artifact])), [artifacts])
  // 选中项里已经从列表消失的（被删、被移除）不再算数
  const selected = useMemo(() => selection.selection.flatMap((entry) => byId.get(entry.path) ?? []), [selection.selection, byId])
  const onDisk = selected.filter((artifact) => !artifact.missing && artifact.path)

  function toggleGroup(id: string) {
    const next = new Set(tabState.expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onTabStateChange({ expanded: [...next] })
  }

  function openArtifact(artifact: Artifact) {
    onTabStateChange({ selected: artifact.id })
    if (artifact.path) onOpenFile({ path: artifact.path, line: null, endLine: null })
  }

  // 只删登记，不动磁盘；主进程会广播刷新，本地先摘掉避免闪一下
  function forgetArtifact(artifact: Artifact) {
    setArtifacts((current) => current.filter((item) => item.id !== artifact.id))
    window.fastAgent.artifacts.remove(artifact.id).catch(() => load())
  }

  function openMenuFor(event: React.MouseEvent, target: ArtifactMenuTarget, itemCount: number) {
    event.preventDefault()
    event.stopPropagation()
    // 在已选中的一批里右键：菜单作用于整批；在批外右键回到单项菜单，并放弃之前的多选。
    if (target.kind === 'artifact' && selected.length > 1 && selection.paths.has(target.artifact.id)) {
      target = { kind: 'batch' }
      itemCount = 4 + (onAddToChat ? 1 : 0)
    } else if (selected.length) selection.clear()
    const point = menuPosition(
      { x: event.clientX, y: event.clientY },
      { width: MENU_WIDTH, height: menuHeight(itemCount) },
      { width: window.innerWidth, height: window.innerHeight }
    )
    setMenu({ ...target, ...point } as ArtifactMenuState)
  }

  async function revealInExplorer(path: string) {
    const error = await window.fastAgent.workspace.reveal(path).catch(() => '无法定位文件')
    if (error) onNotice(error)
  }

  async function openWithLocalApp(path: string) {
    const error = await window.fastAgent.workspace.openExternal(path).catch(() => '无法打开')
    if (error) onNotice(error)
  }

  async function copyPath(path: string) {
    try {
      const absolute = await window.fastAgent.workspace.absolutePath(path)
      await navigator.clipboard.writeText(absolute)
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : '复制失败')
    }
  }

  /** 连文件一起删：删除成功后主进程会同步摘掉产物登记并广播刷新。 */
  async function deleteArtifactFile(artifact: Artifact) {
    if (!artifact.path) return
    const result = await window.fastAgent.workspace.delete(artifact.path).catch(() => ({ ok: false as const, error: '删除失败' }))
    if (!result.ok) {
      onNotice(result.error || '删除失败')
      return
    }
    onFileDeleted?.(artifact.path)
    if (tabState.selected === artifact.id) onTabStateChange({ selected: null })
    onNotice('已删除')
    load()
  }

  function addToChat(items: Artifact[]) {
    const paths = items.flatMap((artifact) => !artifact.missing && artifact.path ? [artifact.path] : [])
    if (!onAddToChat || !paths.length) return
    onAddToChat(`${[...new Set(paths)].join(' ')} `)
    selection.clear()
  }

  async function copyPaths(items: Artifact[]) {
    try {
      const paths = await Promise.all([...new Set(items.flatMap((artifact) => artifact.path ? [artifact.path] : []))].map((path) => window.fastAgent.workspace.absolutePath(path)))
      await navigator.clipboard.writeText(paths.join('\n'))
      onNotice(`已复制 ${paths.length} 条路径`)
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : '复制失败')
    }
  }

  /** 批量只删登记，磁盘文件不动。 */
  function forgetMany(items: Artifact[]) {
    const ids = new Set(items.map((item) => item.id))
    setArtifacts((current) => current.filter((item) => !ids.has(item.id)))
    selection.clear()
    void Promise.all(items.map((item) => window.fastAgent.artifacts.remove(item.id).catch(() => undefined))).then(() => load())
  }

  /** 批量连文件一起删：同一路径被多条登记时只删一次；失败的不影响其余项。 */
  async function deleteMany(items: Artifact[]) {
    const paths = [...new Set(items.flatMap((artifact) => !artifact.missing && artifact.path ? [artifact.path] : []))]
    const failures: string[] = []
    for (const path of paths) {
      const result = await window.fastAgent.workspace.delete(path).catch(() => ({ ok: false as const, error: '删除失败' }))
      if (result.ok) onFileDeleted?.(path)
      else failures.push(`${path}（${result.error || '删除失败'}）`)
    }
    if (items.some((artifact) => artifact.id === tabState.selected)) onTabStateChange({ selected: null })
    selection.clear()
    onNotice(failures.length ? `已删除 ${paths.length - failures.length} 个文件，${failures.length} 个失败：${failures.slice(0, 2).join('、')}${failures.length > 2 ? ' 等' : ''}` : `已删除 ${paths.length} 个文件`)
    load()
  }

  /** 整组移除登记：组里可能有几十条，逐条点太累；只删记录，磁盘文件一律不动。 */
  function forgetGroup(group: ArtifactGroup) {
    const ids = new Set(group.artifacts.map((item) => item.id))
    setArtifacts((current) => current.filter((item) => !ids.has(item.id)))
    void Promise.all(group.artifacts.map((item) => window.fastAgent.artifacts.remove(item.id).catch(() => undefined))).then(() => load())
  }

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    // fixed 定位的菜单不跟着滚，继续显示会悬在错误位置
    setMenu(null)
    if (scrollSaveTimer.current !== null) window.clearTimeout(scrollSaveTimer.current)
    scrollSaveTimer.current = window.setTimeout(() => onTabStateChange({ scrollTop: el.scrollTop }), 250)
  }

  if (!workspaceRoot) {
    return <div className="resource-empty"><FileText size={23} /><strong>未打开工作区</strong><span>打开项目后 Agent 产生的产物会登记在这里。</span></div>
  }

  if (versionsFor) {
    return <div className="resource-scroll">
      <ArtifactVersions artifact={versionsFor} onClose={() => setVersionsFor(null)} onNotice={onNotice} />
    </div>
  }

  return (
    <>
    <div className="resource-scroll tree-scroll" ref={scrollRef} onScroll={onScroll} onKeyDown={selection.onKeyDown} onMouseDown={selection.onScrollMouseDown}>
      {loading && artifacts.length === 0 ? (
        <div className="resource-empty"><LoaderCircle size={20} className="spin" /><span>正在加载产物…</span></div>
      ) : error ? (
        <div className="resource-empty"><CircleAlert size={20} /><strong>加载失败</strong><span>{error}</span></div>
      ) : totalItems === 0 ? (
        <div className="resource-empty"><FileText size={23} /><strong>还没有产物</strong><span>Agent 执行时写出的计划、报告、补丁等文件会出现在这里。</span></div>
      ) : (
        <div className="artifact-groups">
          {visibleGroups.map((group) => (
            <ArtifactGroupRow
              key={group.id}
              group={group}
              expanded={expandedSet.has(group.id)}
              selectedId={tabState.selected}
              checked={selection.paths}
              onToggle={() => toggleGroup(group.id)}
              onArtifactClick={(event, artifact) => selection.handleRowClick(event, { path: artifact.id, kind: 'file' }, order, () => openArtifact(artifact))}
              onForget={forgetArtifact}
              onGroupMenu={(event) => openMenuFor(event, { kind: 'group', group }, 2)}
              onArtifactMenu={(event, artifact) => openMenuFor(event, { kind: 'artifact', artifact }, artifact.missing ? 4 : onContinueEdit ? 8 : 7)}
            />
          ))}
        </div>
      )}
      {selection.marquee && <div className="tree-marquee" style={{ top: selection.marquee.top, height: selection.marquee.height }} aria-hidden="true" />}
    </div>
    {selected.length > 0 && (
      <TreeSelectionBar count={selected.length} summary={onDisk.length < selected.length ? `${selected.length - onDisk.length} 项文件已不存在` : ''} onClear={selection.clear}>
        {onAddToChat && onDisk.length > 0 && <button type="button" onClick={() => addToChat(selected)} title="作为引用添加到输入框"><MessageSquarePlus size={13} />添加到对话</button>}
        <button type="button" onClick={() => void copyPaths(selected)} title="复制全部绝对路径"><Copy size={13} />复制路径</button>
        <button type="button" onClick={() => forgetMany(selected)} title="只移除登记，磁盘文件不动"><X size={13} />移除记录</button>
        {onDisk.length > 0 && <button type="button" className="danger" onClick={() => setPendingDelete(onDisk)} title="连文件一起删除"><Trash2 size={13} />删除文件</button>}
      </TreeSelectionBar>
    )}
    {pendingDelete && (
      <ConfirmDialog
        title={`删除选中的 ${pendingDelete.length} 个产物文件？`}
        lines={[
          '文件会从磁盘上删除，产物记录随之移除。',
          ...pendingDelete.slice(0, 5).map((artifact) => `· ${artifact.path}`),
          ...(pendingDelete.length > 5 ? [`· 以及另外 ${pendingDelete.length - 5} 个`] : [])
        ]}
        confirmLabel="删除"
        danger
        onConfirm={() => { const items = pendingDelete; setPendingDelete(null); void deleteMany(items) }}
        onCancel={() => setPendingDelete(null)}
      />
    )}
    {menu?.kind === 'batch' && <TreeContextMenu x={menu.x} y={menu.y} onDismiss={() => setMenu(null)}>
      {onAddToChat && onDisk.length > 0 && <button role="menuitem" onClick={() => { addToChat(selected); setMenu(null) }}><MessageSquarePlus size={14} />添加 {onDisk.length} 项到对话</button>}
      <button role="menuitem" onClick={() => { void copyPaths(selected); setMenu(null) }}><Copy size={14} />复制 {selected.length} 条绝对路径</button>
      <button role="menuitem" onClick={() => { selection.clear(); setMenu(null) }}><X size={14} />取消选择</button>
      <div className="tree-context-separator" />
      <button role="menuitem" onClick={() => { forgetMany(selected); setMenu(null) }}><X size={14} />移除 {selected.length} 条记录</button>
      {onDisk.length > 0 && <button role="menuitem" className="danger" onClick={() => { setPendingDelete(onDisk); setMenu(null) }}><Trash2 size={14} />删除 {onDisk.length} 个文件</button>}
    </TreeContextMenu>}
    {menu?.kind === 'group' && <TreeContextMenu x={menu.x} y={menu.y} onDismiss={() => setMenu(null)}>
      <button role="menuitem" onClick={() => { toggleGroup(menu.group.id); setMenu(null) }}>
        {expandedSet.has(menu.group.id) ? <><ChevronDown size={14} />折叠任务</> : <><ChevronRight size={14} />展开任务</>}
      </button>
      <div className="tree-context-separator" />
      <button role="menuitem" className="danger" onClick={() => { forgetGroup(menu.group); setMenu(null) }}>
        <X size={14} />移除本组记录
      </button>
    </TreeContextMenu>}
    {menu?.kind === 'artifact' && <TreeContextMenu x={menu.x} y={menu.y} onDismiss={() => setMenu(null)}>
      {/* 文件已不在磁盘上时，打开 / 定位这些操作没有意义，只留记录相关的 */}
      {!menu.artifact.missing && <>
        <button role="menuitem" onClick={() => { openArtifact(menu.artifact); setMenu(null) }}><Eye size={14} />打开预览</button>
        <button role="menuitem" onClick={() => { void openWithLocalApp(menu.artifact.path ?? ''); setMenu(null) }}><AppWindow size={14} />用本地应用打开</button>
        <button role="menuitem" onClick={() => { void revealInExplorer(menu.artifact.path ?? ''); setMenu(null) }}><FolderOpen size={14} />在资源管理器中显示</button>
      </>}
      <button role="menuitem" onClick={() => { void copyPath(menu.artifact.path ?? ''); setMenu(null) }}><Copy size={14} />复制绝对路径</button>
      <button role="menuitem" onClick={() => { setVersionsFor(menu.artifact); setMenu(null) }}><History size={14} />版本历史</button>
      {!menu.artifact.missing && onContinueEdit && menu.artifact.path && <button role="menuitem" onClick={() => { onContinueEdit(continueEditPrompt(menu.artifact.path as string)); setMenu(null) }}><PenLine size={14} />继续修改</button>}
      <div className="tree-context-separator" />
      <button role="menuitem" onClick={() => { forgetArtifact(menu.artifact); setMenu(null) }}><X size={14} />移除记录</button>
      {!menu.artifact.missing && <button role="menuitem" className="danger" onClick={() => { void deleteArtifactFile(menu.artifact); setMenu(null) }}><Trash2 size={14} />删除文件</button>}
    </TreeContextMenu>}
    </>
  )
}

function ArtifactGroupRow({ group, expanded, selectedId, checked, onToggle, onArtifactClick, onForget, onGroupMenu, onArtifactMenu }: {
  group: ArtifactGroup
  expanded: boolean
  selectedId: string | null
  /** 多选集合（产物 id）。 */
  checked: ReadonlySet<string>
  onToggle: () => void
  onArtifactClick: (event: React.MouseEvent, artifact: Artifact) => void
  onForget: (artifact: Artifact) => void
  onGroupMenu: (event: React.MouseEvent) => void
  onArtifactMenu: (event: React.MouseEvent, artifact: Artifact) => void
}) {
  return (
    <div className={`artifact-group ${expanded ? 'open' : ''}`}>
      <button type="button" className={`tree-row group ${expanded ? 'open' : ''}`} onClick={onToggle} aria-expanded={expanded} title={group.name} onContextMenu={onGroupMenu}>
        <ChevronRight size={14} className="tree-chevron" />
        {expanded ? <FolderOpen size={14} className="tree-folder-icon" /> : <Folder size={14} className="tree-folder-icon" />}
        <span className="tree-name">{group.name}</span>
        <span className="tree-meta tree-count">{group.count}</span>
      </button>
      {/* 与对话执行过程同一套展开折叠动画；首次挂载已展开的组不播动画 */}
      <Collapse open={expanded} appear={false}>
        <div className="artifact-group-items">
          {group.artifacts.map((artifact) => (
            <ArtifactRow key={artifact.id} artifact={artifact} selected={selectedId === artifact.id} checked={checked.has(artifact.id)} onClick={(event) => onArtifactClick(event, artifact)} onForget={() => onForget(artifact)} onContextMenu={(event) => onArtifactMenu(event, artifact)} />
          ))}
        </div>
      </Collapse>
    </div>
  )
}

function ArtifactRow({ artifact, selected, checked, onClick, onForget, onContextMenu }: { artifact: Artifact; selected: boolean; checked: boolean; onClick: (event: React.MouseEvent) => void; onForget: () => void; onContextMenu: (event: React.MouseEvent) => void }) {
  const title = artifact.missing ? `${artifact.path ?? artifact.name}（文件已不存在）` : artifact.path ? artifact.path : artifact.name
  return (
    <div className={`tree-row-wrap ${artifact.missing ? 'missing' : ''}`}>
      <button type="button" className={`tree-row artifact ${selected ? 'active' : ''} ${checked ? 'checked' : ''}`} style={{ paddingLeft: 30 + 14 }} data-tree-path={artifact.id} data-tree-kind="file" aria-pressed={checked || undefined} onClick={onClick} title={title} onContextMenu={onContextMenu}>
        {/* 网页产物点开直接渲染，图标上区分出来 */}
        {artifact.missing ? <FileX2 size={14} className="tree-file-icon" /> : artifact.type === 'html' ? <Globe size={14} className="tree-file-icon" /> : <FileCode2 size={14} className="tree-file-icon" />}
        <span className="tree-name">{artifact.name}</span>
        {artifact.missing
          ? <span className="tree-meta tree-missing">已删除</span>
          : <>
            <span className="tree-meta tree-type">{ARTIFACT_TYPE_LABEL[artifact.type] ?? artifact.type}</span>
            {artifact.size !== undefined && <span className="tree-meta tree-size">{humanizeFileSize(artifact.size)}</span>}
          </>}
      </button>
      {/* 文件没了才给「移除记录」：正常产物的清理走工作区右键删除，那条路会连文件一起删 */}
      {artifact.missing && <button
        type="button"
        className="tree-row-action"
        aria-label="移除这条产物记录"
        title="移除记录（不影响磁盘）"
        onClick={onForget}
      ><X size={12} /></button>}
    </div>
  )
}
