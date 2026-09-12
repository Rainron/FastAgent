import { memo, useMemo, useState } from 'react'
import { ChevronDown, Copy, FileDiff } from 'lucide-react'
import type { DiffBlock as DiffBlockData } from '../blocks'
import { parseFileReference } from '../file-reference'
import { useResponseActions } from '../response-context'

const COLLAPSE_LINES = 28

type DiffLineKind = 'add' | 'del' | 'meta' | 'hunk' | 'context'

function classify(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'context'
}

function DiffBlockView({ block }: { block: DiffBlockData }) {
  const actions = useResponseActions()
  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => block.patch.split('\n').map((text, index) => ({ id: index, text, kind: classify(text) })), [block.patch])
  const collapsible = lines.length > COLLAPSE_LINES && block.status !== 'streaming'
  const reference = block.filename ? parseFileReference(block.filename) : null

  return (
    <div className={`diff-block ${collapsible && !expanded ? 'collapsed' : ''}`}>
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
      {collapsible && <button type="button" className="block-expand" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <ChevronDown size={13} />{expanded ? '收起' : `展开全部 ${lines.length} 行`}
      </button>}
    </div>
  )
}

export const DiffBlockRenderer = memo(DiffBlockView, (prev, next) =>
  prev.block.patch === next.block.patch && prev.block.filename === next.block.filename && prev.block.status === next.block.status)
