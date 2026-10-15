import { memo, useState } from 'react'
import { useHeightAnimation } from '../../use-height-animation'
import { alignStartIfAbove } from '../../scroll-anchor'
import { ChevronDown } from 'lucide-react'
import type { ToolResultBlock as ToolResultBlockData } from '../blocks'

const COLLAPSE_CHARS = 600

/** 工具结果默认折叠：长输出会把整条对话撑爆。 */
function ToolResultBlockView({ block }: { block: ToolResultBlockData }) {
  const [expanded, setExpanded] = useState(false)
  // 展开 / 收起是原地换内容，高度从旧值补间到新值，不再一下跳变
  const height = useHeightAnimation<HTMLDivElement>()
  const text = block.summary ?? block.detail ?? ''
  const collapsible = text.length > COLLAPSE_CHARS
  const visible = collapsible && !expanded ? `${text.slice(0, COLLAPSE_CHARS)}…` : text
  const hasStats = block.additions !== null || block.deletions !== null

  return (
    <div className="tool-result-block" ref={height.ref}>
      {hasStats && <div className="tool-result-stats"><i className="add">+{block.additions ?? 0}</i><i className="del">-{block.deletions ?? 0}</i></div>}
      {text ? <pre className="tool-result-body">{visible}</pre> : <div className="tool-result-empty">无输出</div>}
      {collapsible && <button type="button" className="block-expand" onClick={() => { if (expanded) alignStartIfAbove(height.ref.current); height.capture(); setExpanded((value) => !value) }} aria-expanded={expanded}>
        <ChevronDown size={13} />{expanded ? '收起' : '展开完整结果'}
      </button>}
    </div>
  )
}

export const ToolResultBlockRenderer = memo(ToolResultBlockView)
