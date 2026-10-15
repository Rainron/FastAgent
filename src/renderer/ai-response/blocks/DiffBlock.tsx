import { memo, useMemo, useState } from 'react'
import { alignStartIfAbove, useHeightAnimation } from '../../motion'
import { ChevronDown, Copy, FileDiff } from 'lucide-react'
import type { DiffBlock as DiffBlockData } from '../blocks'
import { classifyDiffLine } from '../../diff-lines'
import { parseFileReference } from '../file-reference'
import { useResponseActions } from '../response-context'

const COLLAPSE_LINES = 28

function DiffBlockView({ block }: { block: DiffBlockData }) {
  const actions = useResponseActions()
  const [expanded, setExpanded] = useState(false)
  // 展开 / 收起是原地换内容，高度从旧值补间到新值，不再一下跳变
  const height = useHeightAnimation<HTMLDivElement>()
  const lines = useMemo(() => block.patch.split('\n').map((text, index) => ({ id: index, text, kind: classifyDiffLine(text) })), [block.patch])
  const collapsible = lines.length > COLLAPSE_LINES && block.status !== 'streaming'
  const reference = block.filename ? parseFileReference(block.filename) : null

  return (
    <div className={`diff-block ${collapsible && !expanded ? 'collapsed' : ''}`} ref={height.ref}>
      <div className="diff-block-head">
        <span className="diff-block-meta">
          <FileDiff size={13} />
          {reference
            ? <button type="button" className="diff-block-file" onClick={() => actions.openFile(reference)}>{block.filename}</button>
            : <span className="diff-block-file">{block.filename ?? '变更'}</span>}
          <span className="diff-block-stats"><i className="add">+{block.additions}</i><i className="del">-{block.deletions}</i></span>
        </span>
        <button type="button" className="code-block-action" onClick={() => actions.copyText(block.patch)} aria-label="复制补丁" title="复制补丁"><Copy size={13} /></button>
      </div>
      <div className="diff-block-body">
        {lines.map((line) => <div className={`diff-line ${line.kind}`} key={line.id}><span>{line.text || ' '}</span></div>)}
      </div>
      {collapsible && <button type="button" className="block-expand" onClick={() => { if (expanded) alignStartIfAbove(height.ref.current); height.capture(); setExpanded((value) => !value) }} aria-expanded={expanded}>
        <ChevronDown size={13} />{expanded ? '收起' : `展开全部 ${lines.length} 行`}
      </button>}
    </div>
  )
}

export const DiffBlockRenderer = memo(DiffBlockView, (prev, next) =>
  prev.block.patch === next.block.patch && prev.block.filename === next.block.filename && prev.block.status === next.block.status)
