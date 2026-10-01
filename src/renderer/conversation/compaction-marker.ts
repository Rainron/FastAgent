import type { CompactionHistory, ConversationTurn } from '../../shared/types'

/**
 * 把压缩记录放回会话时间线。
 *
 * 压缩此前只在 toast 和「压缩历史」面板里出现，回到会话里完全看不出哪一段被压过——
 * 主流产品都在消息流里留一条可展开的分隔卡。压缩记录只有时间戳，
 * 按「第一个晚于它的回合之前」插入即可，晚于所有回合的挂在末尾。
 */

export interface CompactionMarkers {
  /** 该回合之前要插入的压缩记录，按时间正序。 */
  beforeTurnId: Record<string, CompactionHistory[]>
  /** 比所有回合都晚的压缩记录，渲染在列表末尾。 */
  trailing: CompactionHistory[]
}

function timeOf(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

export function buildCompactionMarkers(
  turns: Array<Pick<ConversationTurn, 'id' | 'createdAt'>>,
  history: CompactionHistory[]
): CompactionMarkers {
  const markers: CompactionMarkers = { beforeTurnId: {}, trailing: [] }
  if (!history.length) return markers
  // 压缩历史按 createdAt 倒序存库，这里统一转成正序再分配，保证同一回合前的多条顺序可读。
  const ordered = [...history].sort((left, right) => timeOf(left.createdAt) - timeOf(right.createdAt))
  const turnTimes = turns.map((turn) => ({ id: turn.id, at: timeOf(turn.createdAt) }))
  for (const record of ordered) {
    const at = timeOf(record.createdAt)
    const anchor = turnTimes.find((turn) => turn.at > at)
    if (!anchor) { markers.trailing.push(record); continue }
    const bucket = markers.beforeTurnId[anchor.id] ?? []
    bucket.push(record)
    markers.beforeTurnId[anchor.id] = bucket
  }
  return markers
}

/** 触发来源的人话说明；`pi-` 前缀是 Pi 会话内压缩，其余是桌面侧发起的。 */
export function compactionTriggerLabel(triggerReason: string): string {
  if (triggerReason === 'pi-overflow') return '上下文溢出自动压缩'
  if (triggerReason === 'pi-threshold') return '达到阈值自动压缩'
  if (triggerReason === 'pi-manual') return '手动压缩'
  if (triggerReason === 'threshold-desktop') return '达到阈值自动压缩'
  if (triggerReason === 'model-switch') return '换模型前压缩'
  if (triggerReason === 'manual') return '手动压缩'
  return '压缩'
}

/**
 * 分隔卡上的一句摘要：压缩前后各占多少窗口。窗口未知时只报 token 数，不编造百分比。
 *
 * 分母优先取记录里那次压缩生效的窗口：模型换过、连接重新导入过、窗口改过之后，
 * 拿「当前窗口」重算会把当时压到 90% 的记录显示成 6%，看上去像压缩阈值失控。
 * 旧记录没存窗口（0），才退回调用方给的当前窗口。
 */
export function compactionDeltaLabel(record: Pick<CompactionHistory, 'beforeTokens' | 'afterTokens' | 'contextWindow'>, contextWindow: number): string {
  const format = (value: number) => value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(Math.max(0, Math.round(value)))
  const window = record.contextWindow > 0 ? record.contextWindow : contextWindow
  if (!(window > 0)) return `${format(record.beforeTokens)} → ${format(record.afterTokens)} tokens`
  const before = Math.round(record.beforeTokens / window * 100)
  const after = Math.round(record.afterTokens / window * 100)
  return `${before}% → ${after}% · ${format(record.beforeTokens)} → ${format(record.afterTokens)} tokens`
}
