import React, { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Folder, MessageSquareQuote } from 'lucide-react'
import type { GitCommitDetail } from '../../shared/types'
import { buildChangeTree, compressSingleChildDirs, flatChangeRows, flattenChangeRows, toggleCollapsed } from './change-tree'
import { GitDiffView } from './GitDiffView'
import { commitDateText, statusText, statusTone } from './git-view'

type DetailTab = 'files' | 'patch' | 'message'

/** 和未提交改动的目录树共用缩进值 */
const INDENT = 12

interface CommitDetailProps {
  detail: GitCommitDetail | null
  /** 分支还没有任何提交：右栏说明原因，而不是一直转「正在读取」 */
  empty: boolean
  onCopyHash: (hash: string) => void
  onAskModel: (detail: GitCommitDetail) => void
}

/** 「历史」视图的右栏：单条提交的完整信息。文件列表点开取单文件 patch，避免大提交一次拉全量。 */
export const GitCommitDetailView = React.memo(function GitCommitDetailView({ detail, empty, onCopyHash, onAskModel }: CommitDetailProps) {
  const [tab, setTab] = useState<DetailTab>('files')
  const [file, setFile] = useState<string | null>(null)
  const [patch, setPatch] = useState('')
  const [loadingPatch, setLoadingPatch] = useState(false)
  // 提交详情的视图是临时视角，不落偏好：默认目录树、默认全展开
  const [folderView, setFolderView] = useState(true)
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set<string>())

  // 换提交时回到文件页签，否则会拿上一条提交的选中文件去请求 patch。
  useEffect(() => { setTab('files'); setFile(null); setPatch('') }, [detail?.hash])
  // 折叠集是按路径记的，换提交后路径完全不同，留着只会让新提交莫名其妙地收起几个目录
  useEffect(() => { setCollapsedDirs(new Set<string>()) }, [detail?.hash])

  const rows = useMemo(() => {
    const files = detail?.files ?? []
    if (!folderView) return flatChangeRows(files)
    return flattenChangeRows(compressSingleChildDirs(buildChangeTree(files)), collapsedDirs)
  }, [detail?.files, folderView, collapsedDirs])

  useEffect(() => {
    if (!detail) return
    if (tab !== 'patch' && !file) { setPatch(''); return }
    let alive = true
    setLoadingPatch(true)
    void window.fastAgent.git.commitPatch(detail.hash, tab === 'patch' ? null : file)
      .then((value) => { if (alive) setPatch(value) })
      .catch(() => { if (alive) setPatch('') })
      .finally(() => { if (alive) setLoadingPatch(false) })
    return () => { alive = false }
  }, [detail, tab, file])

  if (!detail) return <div className="git-main git-main-empty">{empty ? <strong>这个分支还没有提交</strong> : <span>正在读取提交详情…</span>}</div>

  return <div className="git-main">
    <div className="git-detail-head">
      <div className="git-detail-title">
        <strong className="git-ellipsis" title={detail.subject}>{detail.subject}</strong>
        <button className="git-icon-button" title="复制完整哈希" aria-label="复制完整哈希" onClick={() => onCopyHash(detail.hash)}><Copy size={13} /></button>
        <button className="git-icon-button" title="把这条提交交给 AI 解释" onClick={() => onAskModel(detail)}><MessageSquareQuote size={13} /></button>
      </div>
      <dl className="git-kv">
        <dt>提交</dt><dd className="mono">{detail.hash}</dd>
        <dt>作者</dt><dd>{detail.author}{detail.email ? ` <${detail.email}>` : ''}</dd>
        <dt>时间</dt><dd>{commitDateText(detail.date)}</dd>
        <dt>父提交</dt><dd className="mono">{detail.parents.join(', ') || '（根提交）'}</dd>
        {detail.refs.length > 0 && <><dt>引用</dt><dd className="git-ref-chips">{detail.refs.map((ref) => <span className="git-badge ok" key={ref}>{ref}</span>)}</dd></>}
      </dl>
    </div>
    <div className="git-tabline">
      <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>改动文件 {detail.files.length}</button>
      <button className={tab === 'patch' ? 'on' : ''} onClick={() => { setTab('patch'); setFile(null) }}>完整 patch</button>
      <button className={tab === 'message' ? 'on' : ''} onClick={() => setTab('message')}>提交信息</button>
      {tab === 'files' && detail.files.length > 0 && <>
        <span className="git-grow" />
        <div className="git-view-switch" role="group" aria-label="改动文件显示方式">
          <button className={`git-view-switch-item${folderView ? '' : ' on'}`} aria-pressed={!folderView}
            title="平铺显示完整路径" onClick={() => setFolderView(false)}>文件</button>
          <button className={`git-view-switch-item${folderView ? ' on' : ''}`} aria-pressed={folderView}
            title="按目录树显示，单子目录会并成一行" onClick={() => setFolderView(true)}>目录</button>
        </div>
      </>}
    </div>
    <div className="git-panel-scroll git-detail-body">
      {tab === 'message' && <pre className="git-commit-message">{detail.body || detail.subject}</pre>}
      {tab === 'patch' && (loadingPatch ? <div className="git-panel-empty">正在读取 patch…</div> : <GitDiffView patch={patch} empty="这条提交没有文本改动" />)}
      {tab === 'files' && <>
        {detail.files.length === 0
          ? <div className="git-panel-empty">这条提交没有文件改动</div>
          : rows.map((row) => row.kind === 'dir'
            ? <button key={`dir:${row.path}`} className="git-file-row git-dir-row" style={{ paddingLeft: row.depth * INDENT }}
              onClick={() => setCollapsedDirs((current) => toggleCollapsed(current, row.path))}
              title={`${row.path}（${row.paths.length} 个文件）`}>
              {collapsedDirs.has(row.path) ? <ChevronRight size={13} className="git-dir-caret" /> : <ChevronDown size={13} className="git-dir-caret" />}
              <Folder size={13} className="git-dir-icon" />
              <span className="git-ellipsis mono">{row.name}</span>
              <span className="git-dir-count">{row.paths.length}</span>
              <span className="git-plusminus"><i className="add">+{row.additions}</i> <i className="del">-{row.deletions}</i></span>
            </button>
            : <button key={row.path} className={`git-file-row ${file === row.path ? 'selected' : ''}`}
              style={{ paddingLeft: row.depth * INDENT }}
              onClick={() => setFile(file === row.path ? null : row.path)} title={row.path}>
              <span className={`git-file-status ${statusTone(row.file?.status ?? 'M')}`} title={statusText(row.file?.status ?? 'M')}>{row.file?.status ?? 'M'}</span>
              <span className="git-ellipsis mono">{row.name}</span>
              <span className="git-plusminus">{row.file?.binary ? <i className="muted">二进制</i> : <><i className="add">+{row.additions}</i> <i className="del">-{row.deletions}</i></>}</span>
            </button>)}
        {file && <div className="git-inline-diff">{loadingPatch ? <div className="git-panel-empty">正在读取 diff…</div> : <GitDiffView patch={patch} empty="没有可展示的差异" />}</div>}
      </>}
    </div>
  </div>
})
