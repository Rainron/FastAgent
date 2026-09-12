import { memo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ToolResultBlock as ToolResultBlockData } from '../blocks'

const COLLAPSE_CHARS = 600

/** 工具结果默认折叠：长输出会把整条对话撑爆。 */
function ToolResultBlockView({ block }: { block: ToolResultBlockData }) {
  const [expanded, setExpanded] = useState(false)
  const text = block.summary ?? block.detail ?? ''
  const collapsible = text.length > COLLAPSE_CHARS
  const visible = collapsible && !expanded ? `${text.slice(0, COLLAPSE_CHARS)}…` : text
  const hasStats = block.additions !== null || block.deletions !== null

  return (
    <div className="tool-result-block">
      {hasStats && <div className="tool-result-stats"><i className="add">+{block.additions ?? 0}</i><i className="del">-{block.deletions ?? 0}</i></div>}
      {text ? <pre className="tool-result-body">{visible}</pre> : <div className="tool-result-empty">无输出</div>}
      {collapsible && <button type="button" className="block-expand" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <ChevronDown size={13} />{expanded ? '收起' : '展开完整结果'}
      </button>}
    </div>
  )
}

export const ToolResultBlockRenderer = memo(ToolResultBlockView)
