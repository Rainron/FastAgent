import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { ModelUsageOverview, ModelUsageWindow } from '../../shared/types'
import { axisLabelEvery, buildUsageBars, cacheHitRate, dayKey, formatTokenCount, shiftDay, sortByTotalTokens, usageWindowSummary } from './usage-format'

const RANGES = [7, 30, 90] as const

/**
 * 用量仪表盘：KPI 带 + 逐日图 + 模型排行。
 * 数据只在窗口切换时拉一次；渲染派生全部 useMemo，避免表格重排时反复排序。
 */
export function UsageSettings({ onNotice }: { onNotice: (notice: string) => void }) {
  // preset 为 null 表示走自定义日期；两者各自保留上次的值，来回切不用重填
  const [preset, setPreset] = useState<number | null>(30)
  const [custom, setCustom] = useState(() => ({ start: shiftDay(dayKey(), -29), end: dayKey() }))
  const [overview, setOverview] = useState<ModelUsageOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const today = useMemo(() => dayKey(), [])

  // 对象字面量每次渲染都是新引用，effect 依赖只认里面的三个原始值
  const range = useMemo<ModelUsageWindow>(() => preset ?? { start: custom.start, end: custom.end }, [preset, custom.start, custom.end])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void window.fastAgent.usage.overview(range)
      .then((result) => { if (!cancelled) setOverview(result) })
      .catch(() => { if (!cancelled) onNotice('用量数据加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [range, onNotice])

  const bars = useMemo(() => (overview ? buildUsageBars(overview.byDay) : []), [overview])
  const hitRate = useMemo(() => (overview ? cacheHitRate(overview) : null), [overview])
  const models = useMemo(() => (overview ? sortByTotalTokens(overview.byModel) : []), [overview])
  const peakTotal = useMemo(() => Math.max(0, ...bars.map((bar) => bar.total)), [bars])
  const modelMaxTotal = useMemo(() => Math.max(0, ...models.map((row) => row.inputTokens + row.outputTokens)), [models])
  const labelEvery = axisLabelEvery(bars.length)

  return <section className="settings-panel" aria-labelledby="settings-usage">
    <div className="settings-section-heading">
      <div><h2 id="settings-usage">用量统计</h2><p>跨会话的模型调用与 token 消耗，按本地日期汇总。</p></div>
      <div className="usage-range-group">
        <div className="usage-range" role="group" aria-label="统计窗口">
          {RANGES.map((option) => <button key={option} className={`usage-range-button ${preset === option ? 'on' : ''}`} onClick={() => setPreset(option)} aria-pressed={preset === option}>近 {option} 天</button>)}
          <button className={`usage-range-button ${preset === null ? 'on' : ''}`} onClick={() => setPreset(null)} aria-pressed={preset === null}>自定义</button>
          {loading && overview && <LoaderCircle size={13} className="spin usage-range-loading" aria-label="加载中" />}
        </div>
        {preset === null && <div className="usage-range-dates">
          <label>
            <span>开始</span>
            <input type="date" value={custom.start} max={custom.end} onChange={(event) => { if (event.target.value) setCustom((current) => ({ ...current, start: event.target.value })) }} />
          </label>
          <span className="usage-range-sep">~</span>
          <label>
            <span>结束</span>
            <input type="date" value={custom.end} min={custom.start} max={today} onChange={(event) => { if (event.target.value) setCustom((current) => ({ ...current, end: event.target.value })) }} />
          </label>
        </div>}
      </div>
    </div>
    {loading && !overview ? <div className="section-list-empty"><LoaderCircle size={18} className="spin" /> 用量数据加载中</div> : !overview || overview.totals.requestCount === 0 ? <div className="section-list-empty">所选时间范围内还没有模型调用记录</div> : <div className={`usage-body${loading ? ' loading' : ''}`} aria-busy={loading}>
      <div className="usage-cards">
        <div className="usage-card usage-card-primary">
          <small>总 token 消耗 <em className="usage-window">{usageWindowSummary(range)}</em></small>
          <strong>{formatTokenCount(overview.totals.inputTokens + overview.totals.outputTokens)}</strong>
          <span className="usage-split"><i className="usage-dot input" />输入 {formatTokenCount(overview.totals.inputTokens)}<i className="usage-dot output" />输出 {formatTokenCount(overview.totals.outputTokens)}</span>
        </div>
        <div className="usage-card">
          <small>请求数</small>
          <strong>{overview.totals.requestCount}</strong>
          <span className="usage-sub">{overview.totals.failedCount > 0 || overview.totals.cancelledCount > 0 ? `失败 ${overview.totals.failedCount} · 取消 ${overview.totals.cancelledCount}` : '无失败与取消'}</span>
        </div>
        <div className="usage-card">
          <small>缓存命中率</small>
          <strong>{hitRate === null ? '—' : `${Math.round(hitRate * 100)}%`}</strong>
          <span className="usage-sub">读缓存 {formatTokenCount(overview.totals.cacheReadTokens)} · 写 {formatTokenCount(overview.totals.cacheWriteTokens)}</span>
        </div>
      </div>
      {bars.length > 0 && <div className="usage-chart" role="img" aria-label="逐日 token 消耗柱状图">
        <div className="usage-chart-top">
          <span className="usage-chart-peak">峰值 {formatTokenCount(peakTotal)} / 天</span>
          <div className="usage-chart-legend"><span className="usage-dot input" />输入（含缓存）<span className="usage-dot output" />输出</div>
        </div>
        <div className="usage-chart-plot">
          <div className="usage-gridlines" aria-hidden="true"><span /><span /><span /><span /><span /></div>
          <div className="usage-chart-bars">
            {bars.map((bar) => <div key={bar.day} className="usage-bar-col" title={`${bar.day}｜请求 ${bar.requestCount} 次｜输入 ${formatTokenCount(bar.segments[0].tokens)} · 输出 ${formatTokenCount(bar.segments[1].tokens)}`}>
              <div className="usage-bar">
                {bar.percents.map((part) => <div key={part.key} className={`usage-bar-segment ${part.key}`} style={{ height: `${part.percent}%` }} />)}
              </div>
            </div>)}
          </div>
        </div>
        <div className="usage-chart-axis">
          {bars.map((bar, index) => <span key={bar.day}>{index % labelEvery === 0 || index === bars.length - 1 ? bar.day.slice(5) : ''}</span>)}
        </div>
      </div>}
      {models.length > 0 && <div className="usage-table">
        <table>
          <thead><tr><th>模型</th><th>请求</th><th>输入</th><th>输出</th><th>最近使用</th></tr></thead>
          <tbody>
            {models.map((row) => {
              const total = row.inputTokens + row.outputTokens
              return <tr key={`${row.provider}:${row.modelName}`}>
                <td>
                  <div className="usage-model-cell"><strong>{row.modelName}</strong><small>{row.provider}</small></div>
                  <span className="usage-model-bar" aria-hidden="true"><i style={{ width: `${modelMaxTotal > 0 ? Math.max(2, (total / modelMaxTotal) * 100) : 0}%` }} /></span>
                </td>
                <td>{row.requestCount}{row.failedCount > 0 && <small className="usage-cell-sub">失败 {row.failedCount}</small>}</td>
                <td>{formatTokenCount(row.inputTokens)}{row.cacheReadTokens > 0 && <small className="usage-cell-sub">含缓存读 {formatTokenCount(row.cacheReadTokens)}</small>}</td>
                <td>{formatTokenCount(row.outputTokens)}</td>
                <td>{row.lastUsedAt.slice(0, 10)}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>}
    </div>}
  </section>
}
