import React, { useCallback, useState } from 'react'
import { ChevronRight, ChevronUp, ExternalLink, Layers } from 'lucide-react'
import type { TurnContextSource } from '../../shared/types'
import { useResponseActions } from '../ai-response/response-context'
import { CONTEXT_GROUP_PREVIEW, canOpenSource, groupContextSources, summarizeContextSources, visibleGroupItems, type ContextSourceGroup } from './context-sources'

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

  const groups = groupContextSources(sources ?? [])
  return <section className="context-source-bar">
    <button className="context-source-heading" onClick={toggle} aria-expanded={expanded} title={expanded ? '收起本轮上下文' : '展开本轮上下文'}>
      <span className="context-source-icon" aria-hidden="true"><Layers size={13} /></span>
      <span className="context-source-label">本轮上下文</span>
      {sources && <span className="context-source-count">{summarizeContextSources(sources) || '无额外来源'}</span>}
      <ChevronRight size={12} className="context-source-chevron" />
    </button>
    {expanded && <div className="context-source-details">
      {!sources && <div className="context-source-empty">加载中</div>}
      {sources && groups.length === 0 && <div className="context-source-empty">这一轮没有额外的上下文来源</div>}
      {groups.map((group) => <ContextSourceGroupView key={group.kind} group={group} onNotice={onNotice} />)}
      {/* 展开后清单可能很长，顶部那行已经滚出视野，底部再给一个收起入口 */}
      <button type="button" className="context-source-collapse" onClick={toggle}><ChevronUp size={12} />收起</button>
    </div>}
  </section>
})

function ContextSourceGroupView({ group, onNotice }: { group: ContextSourceGroup; onNotice: (notice: string) => void }) {
  const [showAll, setShowAll] = useState(false)
  const { openSkill } = useResponseActions()
  const items = visibleGroupItems(group.items, showAll)
  const overflow = group.items.length - CONTEXT_GROUP_PREVIEW

  async function openSource(source: TurnContextSource) {
    if (!source.locator) return
    const error = await window.fastAgent.shell.openPath(source.locator)
    if (error) onNotice(error)
  }

  return <div className="context-source-group">
    <div className="context-source-group-title">
      <span>{group.label} {group.items.length}</span>
      {group.note && <em>{group.note}</em>}
    </div>
    {/* 整组一张列表卡，行间只有一条分隔线：逐条独立描边时几十条 Skill 会散成一屏白条 */}
    <div className="context-source-items">
      {items.map((item) => item.kind === 'skill'
        // Skill 正文不在这里展开：整行是跳转入口，正文与版本去能力页看。
        ? <button type="button" className="context-source-item context-source-link" key={`${item.kind}:${item.refId}`} onClick={() => openSkill(item.refId)} title="在能力页查看这个 Skill">
          <span className="context-source-title">{item.title}</span>
          <ChevronRight size={12} className="context-source-go" />
        </button>
        : <div className="context-source-item" key={`${item.kind}:${item.refId}`}>
          <span className="context-source-title">{item.title}</span>
          {item.detail && <span className="context-source-detail">{item.detail}</span>}
          {canOpenSource(item) && <button className="context-source-open" title={item.locator ?? ''} onClick={() => void openSource(item)}><ExternalLink size={12} /></button>}
        </div>)}
      {overflow > 0 && <button type="button" className="context-source-more" onClick={() => setShowAll((value) => !value)}>
        <ChevronRight size={11} className={showAll ? 'context-source-more-icon open' : 'context-source-more-icon'} />
        {showAll ? '收起这一组' : `展开其余 ${overflow} 条`}
      </button>}
    </div>
  </div>
}
