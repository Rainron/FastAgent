import { memo, useEffect, useState } from 'react'
import type { RateLimitSnapshot, RateLimitWindow } from '../../shared/types'
import { resetLabel, windowLabel } from '../../shared/rate-limit'

/**
 * 订阅额度：模型服务在响应头里报回来的窗口用量（Codex 的 5 小时 / 周额度、
 * Kimi Code 的配额等），在上下文面板里直接看，不必去网站查。
 *
 * 只显示真实读到的数字：厂商不报额度时整段不出现，不用本地统计凑一个假的百分比。
 */
export function useSubscriptionLimits(): RateLimitSnapshot[] {
  const [snapshots, setSnapshots] = useState<RateLimitSnapshot[]>([])
  useEffect(() => {
    let alive = true
    void window.fastAgent.usage.limits().then((items) => { if (alive) setSnapshots(items) }).catch(() => undefined)
    const off = window.fastAgent.usage.onLimitsChanged((items) => { if (alive) setSnapshots(items) })
    return () => { alive = false; off() }
  }, [])
  return snapshots
}

/** 次窗口没有窗口长度时（通用 API 的请求/令牌配额）退回中性说法，不假装它是周额度。 */
function labelFor(window: RateLimitWindow, fallback: string): string {
  return windowLabel(window.windowMinutes) ?? fallback
}

function LimitRow({ snapshot, window: limit, fallback, now }: { snapshot: RateLimitSnapshot; window: RateLimitWindow; fallback: string; now: number }) {
  const percent = Math.round(limit.usedPercent)
  const reset = resetLabel(snapshot, limit, now)
  return <div className="plan-limit-row">
    <div className="plan-limit-head">
      <span className="plan-limit-name">{labelFor(limit, fallback)}</span>
      {reset && <span className="plan-limit-reset">{reset}</span>}
      <span className="plan-limit-percent">{percent}%</span>
    </div>
    <div className="plan-limit-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={labelFor(limit, fallback)}>
      <span className={percent >= 90 ? 'danger' : percent >= 70 ? 'warn' : ''} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  </div>
}

export const SubscriptionLimits = memo(function SubscriptionLimits({ snapshots }: { snapshots: RateLimitSnapshot[] }) {
  // 倒计时每分钟自己往前走，不等下一次模型请求才刷新。
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!snapshots.length) return
    const timer = globalThis.setInterval(() => setNow(Date.now()), 30_000)
    return () => globalThis.clearInterval(timer)
  }, [snapshots.length])

  if (!snapshots.length) return null
  return <div className="plan-limits">
    {snapshots.map((snapshot) => <section key={snapshot.connectionId} className="plan-limit-group">
      <div className="plan-limit-title">订阅额度 · {snapshot.label}</div>
      {snapshot.primary && <LimitRow snapshot={snapshot} window={snapshot.primary} fallback="主额度" now={now} />}
      {snapshot.secondary && <LimitRow snapshot={snapshot} window={snapshot.secondary} fallback="次额度" now={now} />}
    </section>)}
  </div>
})
