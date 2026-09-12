import { useEffect, useState } from 'react'
import { Archive, Bot, CheckCircle2, Clock3, FolderKanban, Search, XCircle } from 'lucide-react'
import type { ConversationDetailed, ConversationMode, ConversationStats, ModelOption, ProjectRecord, TurnStatus } from '../../../../shared/types'
import type { ConversationScope } from '../../../workspace-data'
import { Pagination } from '../../../components/Pagination'
import { useDebounced } from '../../../use-debounced'
import { usePagination } from '../../../use-pagination'

type StatusFilter = TurnStatus | 'idle' | 'all'

const modeLabels: Record<ConversationMode, string> = { chat: '对话', agent: 'Agent' }
const statusLabels: Record<TurnStatus | 'idle', string> = { working: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted', idle: 'Idle' }

function formatUpdatedAt(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function contextLabel(item: ConversationDetailed) {
  if (!item.context || item.context.contextWindow <= 0) return '—'
  const percent = Math.round((item.context.estimatedTokens / item.context.contextWindow) * 100)
  return `${(item.context.estimatedTokens / 1000).toFixed(1)}k / ${Math.round(item.context.contextWindow / 1000)}k · ${percent}%`
}

function compactionLabel(item: ConversationDetailed) {
  const count = item.context?.compactionCount ?? 0
  if (!count) return '未压缩'
  const latest = item.compactionHistory[0]?.createdAt
  return latest ? `${count} 次 · ${new Date(latest).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : `${count} 次`
}

export function ConversationsPage({ models, projects, onOpenInspector, onNotice }: { models: ModelOption[]; projects: ProjectRecord[]; onOpenInspector: (conversationId: string) => void; onNotice: (notice: string) => void }) {
  const [items, setItems] = useState<ConversationDetailed[]>([])
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<ConversationScope>('all')
  const [mode, setMode] = useState<ConversationMode | 'all'>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<ConversationStats>({ total: 0, active: 0, agent: 0, failed: 0 })
  const { page, pageSize, setPage, setPageSize } = usePagination()
  // 关键词逐字打会打满 IPC，等停手再查
  const keyword = useDebounced(query, 250)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void window.fastAgent.conversations.listDetailedPage({
      page, pageSize, includeArchived: showArchived,
      keyword: keyword.trim() || undefined,
      projectScope: scope,
      mode: mode === 'all' ? undefined : mode,
      status: status === 'all' ? undefined : status
    }).then((result) => {
      if (cancelled) return
      setItems(result.items); setTotal(result.total)
      // 归档后总数缩水时服务端会夹回页码，本地跟上才不会停在空页
      if (result.page !== page) setPage(result.page)
    }).catch(() => { if (!cancelled) onNotice('会话列表加载失败') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [onNotice, showArchived, page, pageSize, setPage, keyword, scope, mode, status])

  useEffect(() => {
    let cancelled = false
    void window.fastAgent.conversations.stats(showArchived).then((next) => { if (!cancelled) setStats(next) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [showArchived, items])

  function modelName(item: ConversationDetailed) {
    if (item.runtime.modelId === null) return '未选择'
    return models.find((model) => model.id === item.runtime.modelId)?.name || String(item.runtime.modelId)
  }

  function projectName(item: ConversationDetailed) {
    if (!item.projectId) return '快速对话'
    return projects.find((project) => project.id === item.projectId)?.name || '已删除的项目'
  }

  const statCards = [
    { label: '可见会话', value: stats.total, icon: FolderKanban, tone: '' },
    { label: '正在运行', value: stats.active, icon: Clock3, tone: 'running' },
    { label: 'Agent 会话', value: stats.agent, icon: Bot, tone: 'agent' },
    { label: '最近失败', value: stats.failed, icon: XCircle, tone: stats.failed ? 'danger' : '' }
  ]

  return <section className="conversations-page" aria-labelledby="conversations-title">
    <div className="section-list-header"><div><span className="eyebrow">WORKSPACE</span><h1 id="conversations-title">会话</h1><p>集中查找和管理所有会话。选择一项查看 Context、摘要、压缩历史与运行详情。</p></div></div>
    <div className="conversation-stat-grid">{statCards.map(({ label, value, icon: Icon, tone }) => <div className={`conversation-stat-card ${tone}`} key={label}><Icon size={15} /><div><strong>{value}</strong><span>{label}</span></div></div>)}</div>
    <div className="conversation-toolbar">
      <div className="conversation-search"><Search size={14} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="搜索会话标题" aria-label="搜索会话标题" /></div>
      <select value={scope} onChange={(event) => { setScope(event.target.value as ConversationScope); setPage(1) }} aria-label="按项目归属筛选"><option value="all">所有项目</option><option value="unassigned">快速对话</option>{projects.filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <select value={mode} onChange={(event) => { setMode(event.target.value as ConversationMode | 'all'); setPage(1) }} aria-label="按模式筛选"><option value="all">所有模式</option>{(['chat', 'agent'] as ConversationMode[]).map((item) => <option key={item} value={item}>{modeLabels[item]}</option>)}</select>
      <select value={status} onChange={(event) => { setStatus(event.target.value as StatusFilter); setPage(1) }} aria-label="按状态筛选"><option value="all">所有状态</option>{(['idle', 'working', 'completed', 'failed', 'cancelled'] as Array<TurnStatus | 'idle'>).map((item) => <option key={item} value={item}>{statusLabels[item]}</option>)}</select>
      <label className="conversation-archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => { setShowArchived(event.target.checked); setPage(1) }} /><span>含归档</span></label>
    </div>
    <div className="conversation-list-heading"><span>{total} 个会话</span><small>按最近更新时间排列</small></div>
    <div className="conversation-card-list" aria-label="会话列表">
      {items.map((item) => { const currentStatus = item.runtime.status ?? 'idle'; return <button className={`conversation-card ${item.archived ? 'archived' : ''}`} key={item.id} onClick={() => onOpenInspector(item.id)}>
        <div className="conversation-card-main"><div className="conversation-card-title"><span className={`conversation-status-dot ${currentStatus}`} /><strong>{item.title}</strong>{item.archived && <span className="conversation-archived-label"><Archive size={11} />已归档</span>}</div><div className="conversation-card-meta"><span><FolderKanban size={12} />{projectName(item)}</span><span>{item.runtime.mode ? modeLabels[item.runtime.mode] : '未运行'}</span><span>{modelName(item)}</span></div></div>
        <div className="conversation-card-context"><span>Context</span><strong>{contextLabel(item)}</strong><small>{compactionLabel(item)}</small></div>
        <div className={`conversation-card-status ${currentStatus}`}><span>{statusLabels[currentStatus]}</span><small>{formatUpdatedAt(item.updatedAt)}</small></div>
      </button> })}
      {items.length === 0 && !loading && <div className="conversation-empty"><CheckCircle2 size={20} /><strong>没有符合条件的会话</strong><span>试试清除筛选条件，或搜索其他标题。</span></div>}
    </div>
    <Pagination page={page} pageSize={pageSize} total={total} disabled={loading} onPageChange={setPage} onPageSizeChange={setPageSize} />
  </section>
}
