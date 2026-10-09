import React, { useEffect, useMemo, useState } from 'react'
import { Loader2, MessageSquareQuote, Sparkles, Trash2, Undo2 } from 'lucide-react'
import type { GitFileChange, GitWorkingChanges } from '../../shared/types'
import { splitUnversioned, togglePaths, type ChangeViewMode } from './change-tree'
import { GitChangeList } from './GitChangeList'
import type { GitActiveChange } from './GitWorkingDiff'
import { commitButtonText, retainExisting } from './git-view'
import { useEventCallback } from '../use-event-callback'

interface WorkingViewProps {
  changes: GitWorkingChanges
  busy: boolean
  /** 生成提交信息用的模型；没有可用模型时禁用按钮。 */
  canSuggestMessage: boolean
  /** 改动的组织方式与目录折叠集，落在偏好里由 useGitChangeView 管 */
  viewMode: ChangeViewMode
  collapsedDirs: ReadonlySet<string>
  /** 右栏正在看的文件；由面板持有，左栏点文件改它，右栏据此拉 diff */
  active: GitActiveChange | null
  onActivate: (active: GitActiveChange | null) => void
  onViewModeChange: (mode: ChangeViewMode) => void
  onToggleDir: (path: string) => void
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onCommit: (message: string, amend: boolean, stageAllFirst: boolean) => void
  onDiscard: (tracked: string[], untracked: string[]) => void
  onReset: () => void
  onReviewWithModel: () => void
  onSuggestMessage: () => Promise<string | null>
  onNotice: (message: string) => void
}

const VIEW_MODES: Array<{ mode: ChangeViewMode; label: string; title: string }> = [
  { mode: 'file', label: '文件', title: '平铺显示完整路径' },
  { mode: 'folder', label: '目录', title: '按目录树显示，单子目录会并成一行' },
  { mode: 'status', label: '类型', title: '按新增 / 修改 / 删除等改动类型分组' }
]

/** 「更改」视图的左栏：勾选文件、挑文件看 diff、写提交信息、提交 / amend / 丢弃 / reset。差异本身画在右栏。 */
export const GitWorkingView = React.memo(function GitWorkingView(props: WorkingViewProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { active, onActivate } = props
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

  const allFiles = useMemo(() => [...props.changes.staged, ...props.changes.unstaged], [props.changes])
  // 未暂存的再拆成已跟踪与未纳管两段：后者多是产物和临时文件，混在一起会把真正的改动淹掉
  const { modified, unversioned } = useMemo(() => splitUnversioned(props.changes.unstaged), [props.changes.unstaged])
  // 提交或丢弃之后文件会消失，选中集合要跟着收敛，否则会对不存在的路径下命令。
  useEffect(() => { setSelected((current) => retainExisting(current, allFiles)) }, [allFiles])
  useEffect(() => {
    if (active && !allFiles.some((file) => file.path === active.path)) onActivate(null)
  }, [allFiles, active, onActivate])

  // 下面几个都要传给 memo 的 GitChangeList，引用必须恒定，否则每次输入提交信息都会连带重画整个列表
  // 单文件与目录整组共用一个入口：目录行传进来的是它覆盖的全部路径
  const toggle = useEventCallback((paths: string[]) => setSelected((current) => togglePaths(current, paths)))
  // 丢弃要分开走 tracked / untracked 两条 git 命令，未跟踪文件只能直接删
  const discard = useEventCallback((paths: string[]) => {
    const target = new Set(paths)
    const untracked = allFiles.filter((file) => target.has(file.path) && file.untracked).map((file) => file.path)
    const untrackedSet = new Set(untracked)
    props.onDiscard(paths.filter((path) => !untrackedSet.has(path)), untracked)
  })
  // diff 在右栏常驻，再点同一个文件不必收起
  const openStaged = useEventCallback((file: GitFileChange) => onActivate({ path: file.path, staged: true, untracked: false }))
  const openUnstaged = useEventCallback((file: GitFileChange) => onActivate({ path: file.path, staged: false, untracked: file.untracked }))
  const selectedPaths = [...selected]
  const selectedUntracked = allFiles.filter((file) => selected.has(file.path) && file.untracked).map((file) => file.path)
  const selectedTracked = selectedPaths.filter((path) => !selectedUntracked.includes(path))

  async function suggest() {
    setSuggesting(true)
    try {
      const value = await props.onSuggestMessage()
      if (value) setMessage(value)
    } finally {
      setSuggesting(false)
    }
  }

  const stagedCount = props.changes.staged.length
  const canCommit = !props.busy && message.trim().length > 0 && (amend || stagedCount > 0 || props.changes.unstaged.length > 0)

  return <div className="git-side-pane">
    <div className="git-side-tools">
      <div className="git-side-tools-row">
        <div className="git-view-switch" role="group" aria-label="改动显示方式">
          {VIEW_MODES.map((item) => <button key={item.mode} className={`git-view-switch-item${props.viewMode === item.mode ? ' on' : ''}`}
            aria-pressed={props.viewMode === item.mode} title={item.title}
            onClick={() => props.onViewModeChange(item.mode)}>{item.label}</button>)}
        </div>
        <span className="git-grow" />
        <button className="git-icon-button" disabled={props.busy || !allFiles.length} title="把未提交 diff 交给 AI 审查" aria-label="AI 审查" onClick={props.onReviewWithModel}>
          <MessageSquareQuote size={14} />
        </button>
        <button className="git-icon-button danger" disabled={props.busy || !selectedPaths.length} title="丢弃选中文件的改动（不可恢复）" aria-label="丢弃所选"
          onClick={() => props.onDiscard(selectedTracked, selectedUntracked)}><Trash2 size={14} /></button>
        <button className="git-icon-button" disabled={props.busy} title="回退最近一次提交，改动保留在工作区" aria-label="回退提交" onClick={props.onReset}>
          <Undo2 size={14} />
        </button>
      </div>
    </div>
    <div className="git-panel-scroll git-side-body">
      {allFiles.length === 0 && <div className="git-clean-state"><strong>工作区是干净的</strong><span>没有需要提交的改动</span></div>}
      {allFiles.length > 0 && <>
      {/* 空分组整段不出现：「暂存区是空的」这类占位只是噪音，没有分组本身就说明了 */}
      {stagedCount > 0 && <>
        <div className="git-group-head">
          已暂存 {stagedCount}
          <button className="git-text-button" disabled={props.busy} onClick={() => props.onUnstage(props.changes.staged.map((file) => file.path))}>全部取消暂存</button>
        </div>
        <GitChangeList files={props.changes.staged} mode={props.viewMode} staged busy={props.busy}
          selected={selected} collapsedDirs={props.collapsedDirs} activePath={active?.staged ? active.path : null}
          onToggleSelect={toggle} onToggleDir={props.onToggleDir}
          onOpen={openStaged}
          onStageToggle={props.onUnstage} onDiscard={discard} onNotice={props.onNotice} />
      </>}

      {modified.length > 0 && <>
        <div className="git-group-head">
          已修改 {modified.length}
          <button className="git-text-button" disabled={props.busy} onClick={() => props.onStage(modified.map((file) => file.path))}>全部暂存</button>
        </div>
        <GitChangeList files={modified} mode={props.viewMode} staged={false} busy={props.busy}
          selected={selected} collapsedDirs={props.collapsedDirs} activePath={active && !active.staged ? active.path : null}
          onToggleSelect={toggle} onToggleDir={props.onToggleDir}
          onOpen={openUnstaged}
          onStageToggle={props.onStage} onDiscard={discard} onNotice={props.onNotice} />
      </>}

      {unversioned.length > 0 && <>
        <div className="git-group-head">
          未纳管 {unversioned.length}
          <button className="git-text-button" disabled={props.busy} onClick={() => props.onStage(unversioned.map((file) => file.path))}>全部暂存</button>
        </div>
        <GitChangeList files={unversioned} mode={props.viewMode} staged={false} busy={props.busy}
          selected={selected} collapsedDirs={props.collapsedDirs} activePath={active && !active.staged ? active.path : null}
          onToggleSelect={toggle} onToggleDir={props.onToggleDir}
          onOpen={openUnstaged}
          onStageToggle={props.onStage} onDiscard={discard} onNotice={props.onNotice} />
      </>}
      </>}
    </div>
    <div className="git-commit-box">
      <textarea className="git-commit-input" value={message} placeholder="提交信息（首行写 Conventional Commits 主题）"
        disabled={props.busy} onChange={(event) => setMessage(event.target.value)} />
      <div className="git-commit-actions">
        <button className="git-text-button" disabled={props.busy || suggesting || !props.canSuggestMessage}
          title={props.canSuggestMessage ? '按当前改动生成提交信息' : '请先在输入框选择可用模型'} onClick={() => void suggest()}>
          {suggesting ? <Loader2 size={13} className="git-spin" /> : <Sparkles size={13} />}AI 生成
        </button>
        <button className={`git-toggle ${amend ? 'on' : ''}`} aria-pressed={amend} disabled={props.busy}
          title="把这次改动并入上一条提交" onClick={() => setAmend((value) => !value)}>amend</button>
        <span className="git-grow" />
        <button className="git-primary-button" disabled={!canCommit}
          onClick={() => { props.onCommit(message, amend, stagedCount === 0); setMessage(''); setAmend(false) }}>
          {commitButtonText(stagedCount, modified.length, unversioned.length, amend)}
        </button>
      </div>
    </div>
  </div>
})
