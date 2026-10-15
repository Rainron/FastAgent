import React, { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Diff, ExternalLink, LoaderCircle, Undo2 } from 'lucide-react'
import type { AgentFileChange } from '../../shared/types'
import { useResponseActions } from '../ai-response/response-context'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Collapse, usePresence, useScrollAnchor, MOTION_DURATIONS } from '../motion'
import { useTurnChanges } from './hooks/use-turn-changes'
import { canRevertTurn, fileStatus, revertConfirmLines, revertNotice, sortForList, splitPath, turnChangesBreakdown, turnChangesTitle } from './turn-changes'

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
  if (loading) return <div className="turn-changes-diff empty"><LoaderCircle size={13} className="spin" />正在读取差异…</div>
  // 二进制、超大文件、或改动块太大时主进程只给了行数，没有逐行 diff
  if (!diff) return <div className="turn-changes-diff empty">这个文件没有逐行差异可看</div>
  return <div className="turn-changes-diff">
    {lines.map((line) => <div className={`diff-line ${line.kind}`} key={line.id}><span>{line.text || ' '}</span></div>)}
  </div>
}

function FileRow({ file, turnId, open, onToggle }: { file: AgentFileChange; turnId: string; open: boolean; onToggle: () => void }) {
  const actions = useResponseActions()
  const { dir, name } = splitPath(file.path)
  const status = fileStatus(file)
  // 删掉的、撤销掉的新建文件已经不在磁盘上，不给打开入口
  const openable = file.operation !== 'delete' && !(file.operation === 'create' && file.reverted)
  return <div className={`turn-changes-file${open ? ' open' : ''}${file.reverted ? ' reverted' : ''}`}>
    <div className="turn-changes-row">
      <button type="button" className="turn-changes-path" onClick={onToggle} disabled={!file.hasDiff} aria-expanded={open} title={file.hasDiff ? `${open ? '收起' : '查看'} ${file.path} 的差异` : file.path}>
        <span className={`turn-changes-status ${status.kind}`} title={status.label} aria-label={status.label}>{status.letter}</span>
        {/* 文件名在前、目录在后：文件多时一列文件名对齐，扫一眼就知道改了哪些 */}
        <span className="name">{name}</span>
        {dir && <span className="dir">{dir.slice(0, -1)}</span>}
        {file.reverted && <span className="turn-changes-tag">已撤销</span>}
      </button>
      {openable && <button type="button" className="turn-changes-open" onClick={() => actions.openFile({ path: file.path, line: null, endLine: null })} aria-label={`打开 ${file.path}`} title="打开文件"><ExternalLink size={12} /></button>}
      <span className="turn-changes-stats">
        {file.additions > 0 && <i className="add">+{file.additions}</i>}
        {file.deletions > 0 && <i className="del">-{file.deletions}</i>}
      </span>
    </div>
    <Collapse open={open} appear={false}><FileDiffView turnId={turnId} path={file.path} /></Collapse>
  </div>
}

/**
 * 回合末尾的改动卡片：这一轮 Agent 改了哪些文件、各增删多少行，可以逐个看差异或整轮撤销。
 * 数据来自主进程的变更台账（工具调用前后的快照对比），用户自己改的文件不会算进来。
 */
export const TurnChangesCard = React.memo(function TurnChangesCard({ turnId, onNotice }: { turnId: string; onNotice: (notice: string) => void }) {
  const { changes, reload } = useTurnChanges(turnId)
  // 默认收起：一轮改十几个文件时整张清单会把回答正文顶出视口，要看再展开。
  const [expanded, setExpanded] = useState(false)
  const [openPaths, setOpenPaths] = useState<ReadonlySet<string>>(() => new Set())
  const [confirming, setConfirming] = useState(false)
  // 撤销确认关闭后保留一小段，让 Overlay 播完退场再卸载
  const confirmingPresence = usePresence(confirming ? true : null, MOTION_DURATIONS.dialogClose)
  const [reverting, setReverting] = useState(false)
  // 展开差异会把下面的内容整段推开，锚住卡片避免视口跳位
  const { ref, anchor } = useScrollAnchor<HTMLElement>()
  const files = useMemo(() => sortForList(changes?.files ?? []), [changes])
  if (!changes || !files.length) return null

  const reviewable = files.filter((file) => file.hasDiff).map((file) => file.path)
  const reviewing = reviewable.length > 0 && reviewable.every((path) => openPaths.has(path))
  const toggle = (path: string) => {
    anchor()
    setOpenPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const toggleExpanded = () => {
    anchor()
    setExpanded((current) => !current)
  }
  const toggleReview = () => {
    anchor()
    // 收起状态下点审核：先展开清单，否则逐个差异都展开了却看不见。
    if (!expanded) {
      setExpanded(true)
      setOpenPaths(new Set(reviewable))
      return
    }
    setOpenPaths(reviewing ? new Set() : new Set(reviewable))
  }
  const breakdown = turnChangesBreakdown(files)
  const revert = async () => {
    setConfirming(false)
    setReverting(true)
    try {
      onNotice(revertNotice(await window.fastAgent.changes.revert(turnId)))
    } catch (error) {
      onNotice(error instanceof Error ? `撤销失败：${error.message}` : '撤销失败')
    } finally {
      setReverting(false)
      reload()
    }
  }

  return <section className={`turn-changes${expanded ? ' expanded' : ''}`} ref={ref}>
    <header className="turn-changes-head">
      <button type="button" className="turn-changes-toggle" onClick={toggleExpanded} aria-expanded={expanded} title={expanded ? '收起文件清单' : '展开文件清单'}>
        <span className="turn-changes-icon" aria-hidden="true"><Diff size={14} /></span>
        <strong>{turnChangesTitle(changes)}</strong>
        <span className="turn-changes-stats"><i className="add">+{changes.additions}</i><i className="del">-{changes.deletions}</i></span>
        {breakdown && <span className="turn-changes-breakdown">{breakdown}</span>}
        <ChevronRight size={14} className="turn-changes-chevron" aria-hidden="true" />
      </button>
      <div className="turn-changes-actions">
        {canRevertTurn(changes) && <button type="button" className="turn-changes-undo" onClick={() => setConfirming(true)} disabled={reverting}>
          {reverting ? <LoaderCircle size={13} className="spin" /> : null}撤销{reverting ? null : <Undo2 size={14} />}
        </button>}
        {reviewable.length > 0 && <button type="button" className="turn-changes-review" onClick={toggleReview} aria-pressed={expanded && reviewing}>{expanded && reviewing ? '收起差异' : '审核'}</button>}
      </div>
    </header>
    <Collapse open={expanded} appear={false}>
      <div className="turn-changes-files">
        {files.map((file) => <FileRow key={file.path} file={file} turnId={turnId} open={openPaths.has(file.path)} onToggle={() => toggle(file.path)} />)}
      </div>
    </Collapse>
    {confirmingPresence.item && <ConfirmDialog title="撤销这一轮的文件改动？" lines={revertConfirmLines(changes)} confirmLabel="撤销" danger open={!confirmingPresence.closing} onConfirm={() => void revert()} onCancel={() => setConfirming(false)} />}
  </section>
})
