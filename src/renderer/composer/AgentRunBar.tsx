import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Circle, FileDiff, LoaderCircle } from 'lucide-react'
import type { AgentFileChange } from '../../shared/types'
import { useResponseActions } from '../ai-response/response-context'
import { useDismiss } from '../use-dismiss'
import { compositionLabel, currentFileLabel, OPERATION_LABEL, OPERATION_MARK, runBarLabel, shouldShowRunBar, sortForList } from './run-changes'
import { useRunChanges } from './use-run-changes'

/** diff 行的着色分类，与代码块里的 .diff-line 样式共用。 */
function diffLineKind(line: string): 'add' | 'del' | 'context' {
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'context'
}

function FileDiffView({ turnId, path }: { turnId: string; path: string }) {
  const [diff, setDiff] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true)
    window.fastAgent.changes.diff(turnId, path)
      .then((text) => { if (alive) { setDiff(text); setLoading(false) } })
      .catch(() => { if (alive) { setDiff(null); setLoading(false) } })
    return () => { alive = false }
  }, [turnId, path])
  const lines = useMemo(() => (diff ?? '').split('\n').map((text, index) => ({ id: index, text, kind: diffLineKind(text) })), [diff])
  if (loading) return <div className="run-bar-diff empty"><LoaderCircle size={13} className="spin" />Loading diff…</div>
  // 二进制、超大文件、或改动块太大时主进程只给了行数，没有逐行 diff
  if (!diff) return <div className="run-bar-diff empty">No line diff available for this file</div>
  return <div className="run-bar-diff">
    {lines.map((line) => <div className={`diff-line ${line.kind}`} key={line.id}><span>{line.text || ' '}</span></div>)}
  </div>
}

function FileRow({ file, turnId, expanded, onToggleDiff }: {
  file: AgentFileChange
  turnId: string
  expanded: boolean
  onToggleDiff: () => void
}) {
  const actions = useResponseActions()
  return <div className={`run-bar-file ${file.operation}`}>
    <div className="run-bar-file-head">
      <span className="run-bar-mark" title={OPERATION_LABEL[file.operation]}>{OPERATION_MARK[file.operation]}</span>
      {/* 删掉的文件打不开，只展示路径 */}
      {file.operation === 'delete'
        ? <span className="run-bar-path" title={file.path}>{file.path}</span>
        : <button type="button" className="run-bar-path" title={`Open ${file.path}`} onClick={() => actions.openFile({ path: file.path, line: null, endLine: null })}>{file.path}</button>}
      <span className="run-bar-stats">
        {file.additions > 0 && <i className="add">+{file.additions}</i>}
        {file.deletions > 0 && <i className="del">−{file.deletions}</i>}
      </span>
      {file.hasDiff && <button type="button" className="run-bar-diff-toggle" aria-expanded={expanded} onClick={onToggleDiff} title="Show diff"><FileDiff size={12} />Diff</button>}
    </div>
    {expanded && <FileDiffView turnId={turnId} path={file.path} />}
  </div>
}

/**
 * 输入框上方的 Agent Run Bar：本轮 Agent 改了哪些文件、增删多少行。
 * 主 Bar 只放「快速扫一眼」的信息，文件清单与差异都收在展开层里。
 * 数据来自主进程的变更账本，不猜、不靠文件监听，用户自己改的文件不会算进来。
 */
export const AgentRunBar = React.memo(function AgentRunBar({ turnId, running }: { turnId: string | null; running: boolean }) {
  const changes = useRunChanges(turnId)
  const [open, setOpen] = useState(false)
  const [openDiff, setOpenDiff] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, panelRef)

  // 切轮时收起：上一轮的文件清单挂在新一轮上会看错
  useEffect(() => {
    setOpen(false)
    setOpenDiff(null)
  }, [turnId])

  const listed = useMemo(() => sortForList(changes.files), [changes.files])
  const composition = compositionLabel(changes)
  const current = running ? currentFileLabel(changes) : ''
  const hasChanges = changes.changedFiles > 0
  // 执行中不出现，终态没有文件操作也不出现；判定规则见 shouldShowRunBar。
  // turnId 单独判一次是为了让 TS 把下面的 turnId 收窄成 string。
  if (!turnId || !shouldShowRunBar({ turnId, running, changedFiles: changes.changedFiles })) return null

  // 外层复刻 composer-wrap 的左右内边距，内层挂 conversation-content——
  // 输入框的宽度就是这两层算出来的，照抄才能真正对齐，不能只写死一个百分比。
  return <div className="run-bar-wrap">
    <div className="conversation-content run-bar-inner" ref={panelRef}>
    {open && hasChanges && <div className="run-bar-panel">
      <div className="run-bar-panel-head">
        <strong>Changes this run</strong>
        <span>{changes.changedFiles} {changes.changedFiles === 1 ? 'file' : 'files'}</span>
      </div>
      <div className="run-bar-files">
        {listed.map((file) => <FileRow
          key={file.path}
          file={file}
          turnId={turnId}
          expanded={openDiff === file.path}
          onToggleDiff={() => setOpenDiff((current) => (current === file.path ? null : file.path))}
        />)}
      </div>
      <div className="run-bar-panel-foot">
        {composition && <span>{composition}</span>}
        <span className="run-bar-stats"><i className="add">+{changes.additions}</i><i className="del">−{changes.deletions}</i></span>
      </div>
    </div>}
    <button
      type="button"
      className={`run-bar ${running ? 'running' : 'done'} ${open ? 'open' : ''}`}
      onClick={() => hasChanges && setOpen((value) => !value)}
      aria-expanded={open}
      disabled={!hasChanges}
      title={hasChanges ? 'Show changes' : undefined}
    >
      {/* 图标与执行轨迹的状态行一致：● 进行中、✓ 已完成 */}
      <span className="run-bar-icon" aria-hidden="true">{running ? <Circle size={9} fill="currentColor" strokeWidth={0} /> : <Check size={12} />}</span>
      <span className="run-bar-label">{runBarLabel(changes, running)}</span>
      {hasChanges && <span className="run-bar-stats"><i className="add">+{changes.additions}</i><i className="del">−{changes.deletions}</i></span>}
      {current && <span className="run-bar-current">{current}</span>}
      {/* 测试 / 构建结果以后接在这里，先留位置，避免加的时候整条重排 */}
      {hasChanges && <ChevronRight size={13} className="run-bar-more" />}
    </button>
    </div>
  </div>
})
