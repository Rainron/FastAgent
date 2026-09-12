import { Clock3 } from 'lucide-react'

export interface CompactionHistoryItem {
  id: string
  beforeTokens: number
  afterTokens: number
  triggerReason: string
  coveredTurnStart: number | null
  coveredTurnEnd: number | null
  strategy: string
  createdAt: string
}

/** 覆盖回合范围以 1 基序号表示；原始回合已被删除或无法定位时不显示范围。 */
function coverageLabel(item: CompactionHistoryItem) {
  if (item.coveredTurnStart === null || item.coveredTurnEnd === null) return null
  const count = item.coveredTurnEnd - item.coveredTurnStart + 1
  return `回合 ${item.coveredTurnStart}-${item.coveredTurnEnd} · ${count} 轮`
}

export function CompactionHistory({ items }: { items: CompactionHistoryItem[] }) {
  if (!items.length) return <div className="inspector-empty">暂无压缩记录</div>
  return <div className="compaction-history">{items.map((item) => {
    const coverage = coverageLabel(item)
    return <div className="compaction-history-item" key={item.id}><div className="compaction-history-time"><Clock3 size={12} />{new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div><strong>{item.beforeTokens.toLocaleString()} → {item.afterTokens.toLocaleString()}</strong><span>{[item.triggerReason, item.strategy, coverage].filter(Boolean).join(' · ')}</span></div>
  })}</div>
}

