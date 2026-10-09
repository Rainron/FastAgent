import React from 'react'
import { GitBranch, Loader2 } from 'lucide-react'
import type { GitCommitSummary } from '../../shared/types'
import { commitDateText } from './git-view'

interface CommitColumnProps {
  branch: string | null
  commits: GitCommitSummary[]
  total: number
  loading: boolean
  selectedHash: string | null
  onSelectCommit: (hash: string) => void
  onLoadMore: () => void
}

/** 「历史」视图的左栏：选中分支的提交时间线，点一条在右栏看详情。 */
export const GitCommitColumn = React.memo(function GitCommitColumn(props: CommitColumnProps) {
  const hasMore = props.commits.length < props.total
  return <div className="git-side-pane">
    <div className="git-side-tools">
      <div className="git-side-tools-row git-history-head">
        <GitBranch size={13} />
        <span className="git-ellipsis">{props.branch ?? 'HEAD'}</span>
        <span className="git-grow" />
        <span className="git-panel-hint">{props.total ? `${props.commits.length}/${props.total}` : ''}</span>
      </div>
    </div>
    <div className="git-panel-scroll git-side-body">
      {props.commits.length === 0
        ? <div className="git-panel-empty">{props.loading ? '正在读取…' : '这个分支还没有提交'}</div>
        : props.commits.map((commit) => <button key={commit.hash}
          className={`git-commit-row ${props.selectedHash === commit.hash ? 'selected' : ''}`}
          onClick={() => props.onSelectCommit(commit.hash)} title={commit.subject}>
          <span className="git-commit-graph" aria-hidden="true"><i /></span>
          <span className="git-commit-copy">
            <span className="git-commit-subject git-ellipsis">{commit.subject}</span>
            <span className="git-commit-meta">{commit.author} · {commitDateText(commit.date)}{commit.parents.length > 1 ? ' · 合并提交' : ''}</span>
          </span>
          <span className="git-commit-hash mono">{commit.shortHash}</span>
        </button>)}
      {hasMore && <button className="git-load-more" disabled={props.loading} onClick={props.onLoadMore}>
        {props.loading ? <Loader2 size={13} className="git-spin" /> : null}加载更早的提交
      </button>}
    </div>
  </div>
})
