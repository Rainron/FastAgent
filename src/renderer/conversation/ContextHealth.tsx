import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Activity, ChevronDown, Gauge } from 'lucide-react'
import { useDismiss } from '../use-dismiss'
import type { CompactionState } from './compaction-state'
import type { ModelUsageSummary } from '../../shared/types'
import { cacheHitLabel, usageAggregateForRecord } from './context-usage'
import './context-usage.css'

export interface ContextHealthData {
  estimatedTokens: number
  contextWindow: number
  messageTokens: number
  toolTokens: number
  systemTokens: number
  summaryTokens?: number
  attachmentTokens?: number
  countingMethod?: 'provider-usage' | 'fallback-estimate'
  modelId?: number | null
  provider?: string | null
  compactionCount: number
  latestCompactionAt?: string | null
  usage?: ModelUsageSummary
  usagePending?: boolean
}

function formatTokens(value: number) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)))
}

export const ContextHealth = memo(function ContextHealth({ data, onCompact, onCancelCompaction, compact, compaction }: { data: ContextHealthData; onCompact?: () => void; onCancelCompaction?: () => void; compact?: boolean; compaction?: CompactionState | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  // 与其他浮层一致：点外部或 Esc 关闭，不必回到触发按钮再点一次
  useDismiss(open, close, ref)
  const ratio = data.contextWindow > 0 ? Math.min(1, Math.max(0, data.estimatedTokens / data.contextWindow)) : 0
  const percent = Math.round(ratio * 100)
  const tone = percent >= 95 ? 'danger' : percent >= 85 ? 'warning' : percent >= 70 ? 'secondary' : 'tertiary'
  const latestUsage = useMemo(() => usageAggregateForRecord(data.usage?.latest ?? null), [data.usage?.latest])
  const hitLabel = cacheHitLabel(latestUsage)
  return <div className={`context-health ${tone}`} ref={ref}>
    <button className="context-health-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" title={`上下文已使用 ${percent}%；最近请求缓存命中率 ${hitLabel}${data.usagePending ? '；本次用量待返回' : ''}`}>
      <Gauge size={13} /><span>{compact ? `${percent}%` : `上下文 ${percent}%`}</span><span className="context-cache-trigger">缓存 {hitLabel}{data.usagePending && <span aria-label="本次用量待返回">*</span>}</span><ChevronDown size={12} />
    </button>
    {open && <div className="context-health-popover" role="dialog" aria-label="上下文使用情况">
      <div className="context-health-heading"><strong>上下文使用情况</strong><span>{formatTokens(data.estimatedTokens)} / {formatTokens(data.contextWindow)}</span></div>
      <div className="context-health-bar"><span style={{ width: `${percent}%` }} /></div>
      <dl className="context-health-breakdown"><div><dt>消息</dt><dd>{formatTokens(data.messageTokens)}</dd></div><div><dt>工具</dt><dd>{formatTokens(data.toolTokens)}</dd></div><div><dt>系统</dt><dd>{formatTokens(data.systemTokens)}</dd></div>{Boolean(data.summaryTokens) && <div><dt>摘要</dt><dd>{formatTokens(data.summaryTokens || 0)}</dd></div>}{Boolean(data.attachmentTokens) && <div><dt>附件</dt><dd>{formatTokens(data.attachmentTokens || 0)}</dd></div>}</dl><div className="context-health-meta"><span>计量</span><span>{data.countingMethod === 'provider-usage' ? '总量：模型 usage · 分类：比例估算' : '统一估算'}</span></div>
      <ModelCacheUsage usage={data.usage} pending={data.usagePending} />
      <div className="context-health-meta"><span><Activity size={12} />压缩 {data.compactionCount} 次</span><span>{data.latestCompactionAt ? `最近 ${new Date(data.latestCompactionAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '尚未压缩'}</span></div>
      {compaction?.status === 'running' && <div className="context-health-compaction" aria-live="polite"><div className="context-health-compaction-label"><span>{compaction.phase}</span><span>{compaction.progress}%</span></div><div className="context-health-compaction-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={compaction.progress}><span style={{ width: `${compaction.progress}%` }} /></div><small>当前会话正在压缩，暂时无法发送；可切换到其它会话继续问答</small>{onCancelCompaction && <button className="context-health-action" onClick={onCancelCompaction}>取消压缩</button>}</div>}
      {compaction?.status !== 'running' && onCompact && <button className="context-health-action" onClick={() => { onCompact(); setOpen(false) }}>立即压缩</button>}
    </div>}
  </div>
})

const ModelCacheUsage = memo(function ModelCacheUsage({ usage, pending }: { usage?: ModelUsageSummary; pending?: boolean }) {
  const [scope, setScope] = useState<'latest' | 'turn' | 'session'>('latest')
  const latest = usage?.latest ?? null
  const aggregate = useMemo(() => scope === 'latest' || !usage ? usageAggregateForRecord(latest) : usage[scope], [latest, scope, usage])
  const partial = aggregate.reportedReadRequests < aggregate.requestCount
  const hitLabel = cacheHitLabel(aggregate)
  return <section className="context-cache" aria-label="模型缓存用量">
    <div className="context-cache-heading"><strong>模型缓存</strong><span>按输入 token 计算</span></div>
    <div className="context-cache-scopes" role="group" aria-label="缓存统计范围">
      {([['latest', '最近请求'], ['turn', '本轮累计'], ['session', '会话累计']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={scope === value} onClick={() => setScope(value)}>{label}</button>)}
    </div>
    <div className="context-cache-rate"><span>{partial && aggregate.reportedReadRequests ? '已报告请求命中率' : '缓存命中率'}</span><strong>{hitLabel}</strong></div>
    {aggregate.requestCount > 0 ? <>
      <dl className="context-cache-breakdown">
        <div><dt>输入总量</dt><dd>{formatTokens(aggregate.inputTokens)}</dd></div>
        <div><dt>缓存读取</dt><dd>{aggregate.reportedReadRequests ? formatTokens(aggregate.cacheReadTokens) : '未确认'}</dd></div>
        <div><dt>缓存写入</dt><dd>{aggregate.reportedWriteRequests ? formatTokens(aggregate.cacheWriteTokens) : '未上报'}</dd></div>
        <div><dt>输出</dt><dd>{formatTokens(aggregate.outputTokens)}</dd></div>
      </dl>
      <p className="context-cache-note">已报告读取 {aggregate.reportedReadRequests}/{aggregate.requestCount} 次 · 写入 {aggregate.reportedWriteRequests}/{aggregate.requestCount} 次</p>
      {scope === 'latest' && latest && <p className="context-cache-note context-cache-model" title={`${latest.provider} / ${latest.modelName}`}>
        {latest.modelName} · {new Date(latest.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}{latest.status !== 'completed' && ` · ${latest.status === 'cancelled' ? '已取消' : '请求失败'}，保留已返回用量`}
      </p>}
      <p className="context-cache-note">命中率 = 缓存读取 ÷ 输入总量。输入包含缓存读取与写入；未确认的请求不计入命中率。</p>
    </> : <p className="context-cache-note">尚无请求用量；收到模型返回后更新。</p>}
    {pending && <p className="context-cache-pending" role="status">正在生成，本次用量待返回{latest ? '；当前显示已有记录。' : '。'}</p>}
  </section>
})

