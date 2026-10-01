import React, { useCallback, useState } from 'react'
import { Brain, ChevronRight, ChevronUp, Trash2 } from 'lucide-react'
import type { MemoryRecord } from '../../shared/types'

const TYPE_LABELS: Record<MemoryRecord['type'], string> = { preference: '偏好', fact: '事实', decision: '决策', experience: '经验' }
const STATUS_LABELS: Record<string, string> = { deleted: '已删除', superseded: '已替代' }

/**
 * 会话内记忆闭环：回合级「注入了什么 / 提取了什么」。
 * 只有主进程确认有活动的回合才渲染本组件，因此挂载即可拉取，无需再发探测请求。
 */
export const MemoryTurnBar = React.memo(function MemoryTurnBar({ turnId, onNotice }: { turnId: string; onNotice: (notice: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [activity, setActivity] = useState<{ recalled: Array<MemoryRecord & { recalledAt: number }>; extracted: MemoryRecord[] } | null>(null)

  const load = useCallback(async () => {
    try { setActivity(await window.fastAgent.memories.turnActivity(turnId)) }
    catch { onNotice('记忆活动加载失败') }
  }, [turnId, onNotice])

  // 首次展开才请求；之后保持本地缓存，删除操作自行刷新。
  function toggle() {
    const next = !expanded
    setExpanded(next)
    if (next && !activity) void load()
  }

  async function removeMemory(id: string) {
    try {
      await window.fastAgent.memories.remove(id)
      onNotice('已删除该记忆')
      await load()
    } catch { onNotice('记忆删除失败') }
  }

  const recalled = activity?.recalled ?? []
  const extracted = activity?.extracted ?? []
  return <section className="memory-turn-bar">
    <button className="memory-turn-heading" onClick={toggle} aria-expanded={expanded} title={expanded ? '收起记忆' : '展开记忆'}>
      <span className="memory-turn-icon" aria-hidden="true"><Brain size={13} /></span>
      <span className="memory-turn-label">记忆</span>
      {activity && <span className="memory-turn-count">注入 {recalled.length} · 提取 {extracted.length}</span>}
      <ChevronRight size={12} className="memory-turn-chevron" />
    </button>
    {expanded && <div className="memory-turn-details">
      {!activity && <div className="memory-turn-empty">加载中</div>}
      {activity && recalled.length === 0 && extracted.length === 0 && <div className="memory-turn-empty">这一轮没有记忆活动</div>}
      {recalled.length > 0 && <MemoryGroup title="本轮注入" items={recalled} onDelete={removeMemory} />}
      {extracted.length > 0 && <MemoryGroup title="本轮提取" items={extracted} onDelete={removeMemory} />}
      <button type="button" className="memory-turn-collapse" onClick={toggle}><ChevronUp size={12} />收起</button>
    </div>}
  </section>
})

function MemoryGroup({ title, items, onDelete }: { title: string; items: Array<MemoryRecord & { recalledAt?: number }>; onDelete: (id: string) => void }) {
  return <div className="memory-turn-group">
    <div className="memory-turn-group-title">{title}</div>
    {items.map((item) => <div key={item.id} className={`memory-turn-item ${item.status !== 'active' ? 'stale' : ''}`}>
      <span className="memory-turn-type">{TYPE_LABELS[item.type]}</span>
      <span className="memory-turn-content">{item.content}</span>
      {STATUS_LABELS[item.status] && <span className="memory-turn-status">{STATUS_LABELS[item.status]}</span>}
      {item.status === 'active' && <button className="memory-turn-delete" onClick={() => void onDelete(item.id)} title="删除这条记忆"><Trash2 size={12} /></button>}
    </div>)}
  </div>
}
