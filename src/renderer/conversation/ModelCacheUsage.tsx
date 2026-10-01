import { memo, useMemo, useState } from 'react'
import type { ModelUsageSummary } from '../../shared/types'
import { cacheHitLabel, usageAggregateForRecord } from './context-usage'
import './context-usage.css'

function formatTokens(value: number) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)))
}

/**
 * 模型缓存与输入输出用量。
 *
 * 这是成本视角，不是「我还能聊多久」，所以不再挤在输入框的上下文环里——
 * 那个浮层每次打开都被这一大块数字占掉六成篇幅。现在只在会话详情里展开。
 */
export const ModelCacheUsage = memo(function ModelCacheUsage({ usage, pending }: { usage?: ModelUsageSummary; pending?: boolean }) {
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
