import React, { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Folder, Minus } from 'lucide-react'
import type { GitFileChange } from '../../shared/types'
import { TreeContextMenu } from '../resource-panel/TreeContextMenu'
import { menuHeight, menuPosition, MENU_WIDTH } from '../resource-panel/tree-menu'
import { buildChangeMenuItems, menuTargetPaths, type ChangeMenuKey } from './change-menu'
import {
  buildChangeTree, compressSingleChildDirs, flatChangeRows, flattenChangeRows, groupChangesByStatus,
  pathsSelectionState, type ChangeRow, type ChangeViewMode
} from './change-tree'
import { statusText, statusTone } from './git-view'

export interface ChangeListProps {
  files: GitFileChange[]
  mode: ChangeViewMode
  staged: boolean
  busy: boolean
  selected: ReadonlySet<string>
  collapsedDirs: ReadonlySet<string>
  activePath: string | null
  onToggleSelect: (paths: string[]) => void
  onToggleDir: (path: string) => void
  onOpen: (file: GitFileChange) => void
  onStageToggle: (paths: string[]) => void
  onDiscard: (paths: string[]) => void
  onNotice: (message: string) => void
}

/** 右键菜单的目标行：记下它覆盖的路径与用来分派动作的元信息 */
interface MenuState {
  x: number
  y: number
  row: ChangeRow
  paths: string[]
}

/** 目录行缩进；侧栏窄，每级只给 12px，深层结构靠路径压缩兜底 */
const INDENT = 12

function SelectBox({ state, disabled, label, onClick }: {
  state: 'all' | 'partial' | 'none'; disabled: boolean; label: string; onClick: () => void
}) {
  return <button className={`git-checkbox ${state === 'none' ? '' : 'on'}`} disabled={disabled}
    aria-pressed={state === 'all'} aria-label={label} onClick={onClick}>
    {state === 'all' ? <Check size={11} /> : state === 'partial' ? <Minus size={11} /> : null}
  </button>
}

function DirRow({ row, collapsed, staged, busy, selection, onToggleSelect, onToggleDir, onStageToggle, onDiscard, onContextMenu }: {
  row: ChangeRow; collapsed: boolean; staged: boolean; busy: boolean; selection: 'all' | 'partial' | 'none'
  onToggleSelect: () => void; onToggleDir: () => void; onStageToggle: () => void; onDiscard: () => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  return <div className="git-file-row git-dir-row" style={{ paddingLeft: row.depth * INDENT }} onContextMenu={onContextMenu}>
    <button type="button" className="git-dir-toggle" onClick={onToggleDir}
      aria-label={collapsed ? `展开目录 ${row.path}` : `折叠目录 ${row.path}`} aria-expanded={!collapsed}>
      {collapsed ? <ChevronRight size={13} className="git-dir-caret" /> : <ChevronDown size={13} className="git-dir-caret" />}
    </button>
    <SelectBox state={selection} disabled={busy} label={`选择目录 ${row.path} 下的 ${row.paths.length} 个文件`} onClick={onToggleSelect} />
    <button className="git-file-main" onClick={onToggleDir} title={`${row.path}（${row.paths.length} 个文件）`}>
      <Folder size={13} className="git-dir-icon" />
      <span className="git-ellipsis mono">{row.name}</span>
      <span className="git-dir-count">{row.paths.length}</span>
      <span className="git-plusminus"><i className="add">+{row.additions}</i> <i className="del">-{row.deletions}</i></span>
    </button>
    <button className="git-icon-button" disabled={busy} onClick={onStageToggle}
      title={staged ? '把整个目录移出暂存区' : '暂存整个目录'}>{staged ? '取消暂存' : '暂存'}</button>
    <button className="git-icon-button danger" disabled={busy} onClick={onDiscard} title="丢弃整个目录的改动（不可恢复）">丢弃</button>
  </div>
}

function FileRow({ row, staged, busy, selected, active, indent, treeMode, onToggleSelect, onOpen, onStageToggle, onContextMenu }: {
  row: ChangeRow; staged: boolean; busy: boolean; selected: boolean; active: boolean; indent: number; treeMode: boolean
  onToggleSelect: () => void; onOpen: () => void; onStageToggle: () => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const file = row.file as GitFileChange
  return <div className={`git-file-row interactive ${active ? 'selected' : ''}`} style={{ paddingLeft: indent }} onContextMenu={onContextMenu}>
    {treeMode && <span className="git-dir-toggle-spacer" aria-hidden="true" />}
    <SelectBox state={selected ? 'all' : 'none'} disabled={busy} label={`${selected ? '取消选择' : '选择'} ${row.path}`} onClick={onToggleSelect} />
    <button className="git-file-main" onClick={onOpen} title={`${row.path}（${statusText(file.status)}）`}>
      <span className={`git-file-status ${statusTone(file.status)}`}>{file.untracked ? '?' : file.status}</span>
      <span className="git-ellipsis mono">{row.name}</span>
      <span className="git-plusminus">{file.binary ? <i className="muted">二进制</i> : <><i className="add">+{file.additions}</i> <i className="del">-{file.deletions}</i></>}</span>
    </button>
    <button className="git-icon-button" disabled={busy} onClick={onStageToggle} title={staged ? '从暂存区移除' : '加入暂存区'}>{staged ? '取消暂存' : '暂存'}</button>
  </div>
}

/**
 * 未提交改动的行渲染：平铺 / 目录树 / 按类型分组三种组织方式共用一套行样式。
 * 组织方式的计算全在 change-tree.ts，这里只负责把行画出来并把操作转回去。
 */
export const GitChangeList = React.memo(function GitChangeList(props: ChangeListProps) {
  const rows = useMemo(() => {
    if (props.mode === 'folder') return flattenChangeRows(compressSingleChildDirs(buildChangeTree(props.files)), props.collapsedDirs)
    return flatChangeRows(props.files)
  }, [props.files, props.mode, props.collapsedDirs])
  const groups = useMemo(() => props.mode === 'status' ? groupChangesByStatus(props.files) : [], [props.files, props.mode])
  const [menu, setMenu] = useState<MenuState | null>(null)

  const menuItems = useMemo(() => menu ? buildChangeMenuItems({
    kind: menu.row.kind,
    staged: props.staged,
    collapsed: props.collapsedDirs.has(menu.row.path),
    targetCount: menu.paths.length,
    multiple: menu.paths.length > 1
  }) : [], [menu, props.staged, props.collapsedDirs])

  const openMenu = (event: React.MouseEvent, row: ChangeRow) => {
    event.preventDefault()
    const paths = menuTargetPaths(row.paths, props.selected)
    const point = menuPosition(
      { x: event.clientX, y: event.clientY },
      { width: MENU_WIDTH, height: menuHeight(buildChangeMenuItems({
        kind: row.kind, staged: props.staged, collapsed: props.collapsedDirs.has(row.path),
        targetCount: paths.length, multiple: paths.length > 1
      }).length) },
      { width: window.innerWidth, height: window.innerHeight }
    )
    setMenu({ x: point.x, y: point.y, row, paths })
  }

  const runMenuAction = (key: ChangeMenuKey) => {
    if (!menu) return
    const { row, paths } = menu
    setMenu(null)
    // 建树逻辑按更宽的 GitCommitFile 声明，这里的行一定来自工作区改动，断言回去
    if (key === 'open' && row.file) props.onOpen(row.file as GitFileChange)
    else if (key === 'toggleDir') props.onToggleDir(row.path)
    else if (key === 'stage') props.onStageToggle(paths)
    else if (key === 'discard') props.onDiscard(paths)
    else if (key === 'copyPath') void navigator.clipboard.writeText(paths.join('\n'))
      .then(() => props.onNotice(paths.length > 1 ? `已复制 ${paths.length} 个路径` : '已复制相对路径'))
      .catch(() => props.onNotice('复制失败'))
    else if (key === 'copyName') void navigator.clipboard.writeText(row.path.split('/').pop() ?? row.path)
      .then(() => props.onNotice('已复制文件名'))
      .catch(() => props.onNotice('复制失败'))
    // reveal 失败时主进程回一段说明文字，成功是空串
    else if (key === 'reveal') void window.fastAgent.workspace.reveal(row.path)
      .then((error) => { if (error) props.onNotice(error) })
      .catch(() => props.onNotice('无法定位文件'))
  }

  const renderFile = (row: ChangeRow, indent: number) => <FileRow
    key={`${props.staged ? 'staged' : 'unstaged'}:${row.path}`}
    row={row} staged={props.staged} busy={props.busy}
    selected={props.selected.has(row.path)} active={props.activePath === row.path} indent={indent} treeMode={props.mode === 'folder'}
    onToggleSelect={() => props.onToggleSelect([row.path])}
    onOpen={() => props.onOpen(row.file as GitFileChange)}
    onStageToggle={() => props.onStageToggle([row.path])}
    onContextMenu={(event) => openMenu(event, row)}
  />

  const contextMenu = menu && <TreeContextMenu x={menu.x} y={menu.y} onDismiss={() => setMenu(null)}>
    {menuItems.map((item) => <React.Fragment key={item.key}>
      {item.separatorBefore && <div className="tree-context-separator" />}
      <button type="button" className={item.danger ? 'danger' : undefined} role="menuitem"
        disabled={props.busy && item.key !== 'copyPath' && item.key !== 'copyName' && item.key !== 'reveal'}
        onClick={() => runMenuAction(item.key)}>{item.label}</button>
    </React.Fragment>)}
  </TreeContextMenu>

  if (props.mode === 'status') return <>{groups.map((group) => <div key={group.code} className="git-status-group">
    <div className="git-status-group-head">
      <span className={`git-file-status ${statusTone(group.code)}`}>{group.code}</span>
      {group.label} {group.rows.length}
      <button className="git-text-button" disabled={props.busy}
        onClick={() => props.onStageToggle(group.rows.map((row) => row.path))}>{props.staged ? '取消暂存' : '暂存'}该组</button>
    </div>
    {group.rows.map((row) => renderFile(row, 0))}
  </div>)}{contextMenu}</>

  return <>{rows.map((row) => row.kind === 'file'
    ? renderFile(row, row.depth * INDENT)
    : <DirRow key={`dir:${props.staged ? 'staged' : 'unstaged'}:${row.path}`} row={row} staged={props.staged} busy={props.busy}
      collapsed={props.collapsedDirs.has(row.path)} selection={pathsSelectionState(row.paths, props.selected)}
      onToggleSelect={() => props.onToggleSelect(row.paths)}
      onToggleDir={() => props.onToggleDir(row.path)}
      onStageToggle={() => props.onStageToggle(row.paths)}
      onDiscard={() => props.onDiscard(row.paths)}
      onContextMenu={(event) => openMenu(event, row)} />)}{contextMenu}</>
})
