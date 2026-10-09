import React, { useEffect, useState } from 'react'
import { FileDiff, Loader2 } from 'lucide-react'
import type { GitFileChange } from '../../shared/types'
import { GitDiffView } from './GitDiffView'
import { statusText, statusTone } from './git-view'

/** 右侧大 diff 当前展示的文件；同一路径的暂存区与工作区是两份不同的差异，要一起记。 */
export interface GitActiveChange {
  path: string
  staged: boolean
  untracked: boolean
}

/**
 * 「更改」视图的右栏：选中文件的完整差异。
 * 左栏只管挑文件，差异单独占满右侧，长 diff 不再挤在文件列表下面。
 */
export const GitWorkingDiff = React.memo(function GitWorkingDiff({ active, file }: { active: GitActiveChange | null; file: GitFileChange | null }) {
  const [patch, setPatch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!active) { setPatch(''); return }
    let alive = true
    setLoading(true)
    void window.fastAgent.git.fileDiff(active.path, active.staged, active.untracked)
      .then((value) => { if (alive) setPatch(value) })
      .catch(() => { if (alive) setPatch('') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [active])

  if (!active) return <div className="git-main git-main-empty">
    <FileDiff size={22} />
    <strong>选择一个文件查看差异</strong>
    <span>左侧勾选要提交的文件，点文件名在这里看改了什么</span>
  </div>

  const slash = active.path.lastIndexOf('/')
  return <div className="git-main">
    <div className="git-main-head">
      {file && <span className={`git-file-status ${statusTone(file.status)}`} title={statusText(file.status)}>{file.untracked ? '?' : file.status}</span>}
      <span className="git-main-path mono" title={active.path}>
        {slash >= 0 && <span className="dir">{active.path.slice(0, slash + 1)}</span>}{active.path.slice(slash + 1)}
      </span>
      {active.staged && <span className="git-main-tag">已暂存</span>}
      <span className="git-grow" />
      {file && !file.binary && <span className="git-plusminus"><i className="add">+{file.additions}</i> <i className="del">-{file.deletions}</i></span>}
    </div>
    <div className="git-main-body">
      {loading ? <div className="git-panel-empty"><Loader2 size={13} className="git-spin" />正在读取差异…</div> : <GitDiffView patch={patch} empty="这个文件没有文本差异" />}
    </div>
  </div>
})
