import { useState } from 'react'
import { ChevronRight, Minimize2 } from 'lucide-react'
import type { CompactionHistory } from '../../shared/types'
import { compactionDeltaLabel, compactionTriggerLabel } from './compaction-marker'

/**
 * 会话时间线上的压缩分隔卡。
 * 压缩把这条线之前的回合换成了摘要，用户必须能在原位看到「这里发生过什么、压成了什么」，
 * 否则上下文突然变短只会被当成丢消息。
 */
export function CompactionMarker({ record, contextWindow }: { record: CompactionHistory; contextWindow: number }) {
  const [expanded, setExpanded] = useState(false)
  const summary = record.summaryText?.trim() || ''
  const time = new Date(record.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return <div className={`compaction-marker${expanded ? ' expanded' : ''}`}>
    <button
      type="button"
      className="compaction-marker-head"
      onClick={() => summary && setExpanded((value) => !value)}
      aria-expanded={summary ? expanded : undefined}
      disabled={!summary}
      title={summary ? (expanded ? '收起摘要' : '展开这次压缩生成的摘要') : '这次压缩没有留下可展示的摘要'}
    >
      <span className="compaction-marker-line" />
      <span className="compaction-marker-label">
        <Minimize2 size={12} />
        {compactionTriggerLabel(record.triggerReason)}
        <span className="compaction-marker-delta">{compactionDeltaLabel(record, contextWindow)}</span>
        <span className="compaction-marker-time">{time}</span>
        {summary && <ChevronRight size={12} className="compaction-marker-chevron" />}
      </span>
      <span className="compaction-marker-line" />
    </button>
    {expanded && summary && <div className="compaction-marker-summary">{summary}</div>}
  </div>
}
