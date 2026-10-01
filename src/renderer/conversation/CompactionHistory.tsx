import { Clock3 } from 'lucide-react'

export interface CompactionHistoryItem {
  id: string
  beforeTokens: number
  afterTokens: number
  triggerReason: string
  coveredTurnStart: number | null
  coveredTurnEnd: number | null
  strategy: string
  summaryText?: string | null
  createdAt: string
}

/** 覆盖回合范围以 1 基序号表示；原始回合已被删除或无法定位时不显示范围。 */
export function coverageLabel(item: Pick<CompactionHistoryItem, 'coveredTurnStart' | 'coveredTurnEnd'>) {
  if (item.coveredTurnStart === null || item.coveredTurnEnd === null) return null
  const count = item.coveredTurnEnd - item.coveredTurnStart + 1
  return `回合 ${item.coveredTurnStart}-${item.coveredTurnEnd} · ${count} 轮`
}

/**
 * 触发来源文案。`pi-` 前缀的是 Pi 在会话内压的，按消息切，没有回合范围；
 * 其余是换模型时按应用回合切出来的。
 */
export function triggerLabel(triggerReason: string) {
  if (triggerReason === 'pi-threshold') return '自动（达到阈值）'
  if (triggerReason === 'pi-overflow') return '自动（上下文溢出）'
  // 桌面侧在一轮结束后按同一阈值补的那次压缩，对用户来说与 Pi 的阈值压缩没有区别。
  if (triggerReason === 'threshold-desktop') return '自动（达到阈值）'
  if (triggerReason === 'pi-manual' || triggerReason === 'manual') return '手动'
  if (triggerReason === 'model-switch') return '换模型'
  return triggerReason
}

export function CompactionHistory({ items }: { items: CompactionHistoryItem[] }) {
  if (!items.length) return <div className="inspector-empty">暂无压缩记录</div>
  return <div className="compaction-history">{items.map((item) => {
    const meta = [triggerLabel(item.triggerReason), item.strategy, coverageLabel(item)].filter(Boolean).join(' · ')
    const summary = item.summaryText?.trim()
    return <div className="compaction-history-item" key={item.id}>
      <div className="compaction-history-time"><Clock3 size={12} />{new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
      <strong>{item.beforeTokens.toLocaleString()} → {item.afterTokens.toLocaleString()}</strong>
      <span>{meta}</span>
      {summary && <details className="compaction-history-summary"><summary>查看摘要</summary><pre>{summary}</pre></details>}
    </div>
  })}</div>
}
