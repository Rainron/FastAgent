import React, { useMemo, useState } from 'react'
import { Check, ChevronDown, Circle, CircleAlert, CircleDashed, CircleDot, ListChecks, X } from 'lucide-react'
import type { ConversationTurn, TodoItem } from '../../shared/types'
import { Collapse } from '../Collapse'
import { conversationPlans, planGroupStatus, planOverallLabel, planOverallStatus, planProgress, planStatusLabel, type ConversationPlanGroup } from './plan-summary'

const icons = { pending: CircleDashed, in_progress: CircleDot, completed: Check, cancelled: X, blocked: CircleAlert, failed: CircleAlert, skipped: Circle }
/** 默认展开进行中的分组与最后一组，避免打开面板看到一片全折叠。 */
function initialExpanded(groups: ConversationPlanGroup[]): Set<string> {
  const ids = groups.filter((group) => planGroupStatus(group.items) === 'working').map((group) => group.turn.id)
  const last = groups.at(-1)
  if (last) ids.push(last.turn.id)
  return new Set(ids)
}
export const PlanDrawer = React.memo(function PlanDrawer({ turns, todosByTurn, onClose }: { turns: ConversationTurn[]; todosByTurn: Record<string, TodoItem[]>; onClose: () => void }) {
  const groups = useMemo(() => conversationPlans(turns, todosByTurn), [turns, todosByTurn])
  const progress = useMemo(() => planProgress(groups), [groups])
  const overall = planOverallStatus(groups)
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(groups))
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  return <aside className="plan-drawer" aria-label="对话计划">
    <div className="plan-drawer-head"><ListChecks size={14} /><h2>任务计划</h2><span className={`plan-overall ${overall}`}>{planOverallLabel(overall)}</span><span className="plan-count">{progress.completed}/{progress.total}</span><button className="icon-button" onClick={onClose} aria-label="关闭计划面板"><X size={16} /></button></div>
    <div className="plan-progress"><div className="plan-progress-track"><i style={{ width: `${progress.percent}%` }} /></div><span>{progress.percent}%</span></div>
    <div className="plan-groups">{groups.map((group) => <PlanGroup key={group.turn.id} group={group} open={expanded.has(group.turn.id)} onToggle={() => toggle(group.turn.id)} />)}</div>
    {groups.length === 0 && <div className="plan-empty"><ListChecks size={22} />当前对话还没有计划</div>}
  </aside>
})
function PlanGroup({ group, open, onToggle }: { group: ConversationPlanGroup; open: boolean; onToggle: () => void }) {
  const stats = planProgress([{ turn: group.turn, items: group.items }])
  return <section className={`plan-group ${planGroupStatus(group.items)}${open ? ' open' : ''}`}><button className="plan-group-toggle" onClick={onToggle} aria-expanded={open}><ChevronDown size={14} /><span className="plan-group-title">{group.turn.userMessage.text.slice(0, 72) || '未命名回合'}</span><span className="plan-group-count">{stats.completed}/{stats.total}</span></button><Collapse open={open} appear={false}><ul className="plan-drawer-list">{group.items.map((item) => { const Icon = icons[item.status]; return <li className={`plan-drawer-item ${item.status}`} key={item.id} title={planStatusLabel(item.status)}><Icon size={14} /><span>{item.content}</span></li> })}</ul></Collapse></section>
}
