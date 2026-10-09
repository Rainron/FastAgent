import React, { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toDiffLines } from '../diff-lines'

const COLLAPSE_LINES = 400

/** patch 渲染：与消息流里的 DiffBlock 共用 diff-lines 的分类规则，长 patch 默认截断。 */
export const GitDiffView = React.memo(function GitDiffView({ patch, empty = '没有可展示的差异' }: { patch: string; empty?: string }) {
  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => toDiffLines(patch), [patch])
  if (!lines.length) return <div className="git-panel-empty">{empty}</div>
  const collapsed = !expanded && lines.length > COLLAPSE_LINES
  const visible = collapsed ? lines.slice(0, COLLAPSE_LINES) : lines
  return <div className="git-diff">
    {visible.map((line) => <div className={`git-diff-line ${line.kind}`} key={line.id}><span>{line.text || ' '}</span></div>)}
    {lines.length > COLLAPSE_LINES && <button type="button" className="git-diff-expand" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <ChevronDown size={13} />{expanded ? '收起' : `展开剩余 ${lines.length - COLLAPSE_LINES} 行`}
    </button>}
  </div>
})
