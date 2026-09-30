import React, { useCallback, useState } from 'react'
import { ChevronRight, ExternalLink, Layers } from 'lucide-react'
import type { TurnContextSource } from '../../shared/types'
import { canOpenSource, groupContextSources, summarizeContextSources } from './context-sources'

/**
 * 回合级「本轮实际用了什么」：知识条目、项目规则、可选中的 Skill。
 * 记忆另有 MemoryTurnBar，两者刻意分开——记忆条目带删除与替代语义，来源只读。
 * 只有主进程确认有记录的回合才渲染本组件，因此展开即拉取，无需先探测。
 */
export const ContextSourceBar = React.memo(function ContextSourceBar({ turnId, onNotice }: { turnId: string; onNotice: (notice: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [sources, setSources] = useState<TurnContextSource[] | null>(null)

  const load = useCallback(async () => {
    try { setSources(await window.fastAgent.conversations.contextSources(turnId)) }
    catch { onNotice('上下文来源加载失败') }
  }, [turnId, onNotice])

  function toggle() {
    const next = !expanded
    setExpanded(next)
    if (next && !sources) void load()
  }

  async function openSource(source: TurnContextSource) {
    if (!source.locator) return
    const error = await window.fastAgent.shell.openPath(source.locator)
    if (error) onNotice(error)
  }

  const groups = groupContextSources(sources ?? [])
  return <section className="context-source-bar">
    <button className="context-source-heading" onClick={toggle} aria-expanded={expanded}>
      <Layers size={13} />
      <span>本轮上下文</span>
      {sources && <span className="context-source-count">{summarizeContextSources(sources) || '无额外来源'}</span>}
      <ChevronRight size={13} className={`context-source-chevron ${expanded ? 'open' : ''}`} />
    </button>
    {expanded && <div className="context-source-details">
      {!sources && <div className="context-source-empty">加载中</div>}
      {sources && groups.length === 0 && <div className="context-source-empty">这一轮没有额外的上下文来源</div>}
      {groups.map((group) => <div className="context-source-group" key={group.kind}>
        <div className="context-source-group-title">{group.label}</div>
        {group.items.map((item) => <div className="context-source-item" key={`${item.kind}:${item.refId}`}>
          <span className="context-source-title">{item.title}</span>
          {item.detail && <span className="context-source-detail">{item.detail}</span>}
          {canOpenSource(item) && <button className="context-source-open" title={item.locator ?? ''} onClick={() => void openSource(item)}><ExternalLink size={12} /></button>}
        </div>)}
      </div>)}
    </div>}
  </section>
})
