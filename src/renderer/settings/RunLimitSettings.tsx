import type { AppSettings, RunLimits } from '../../shared/types'

/**
 * 运行上限。三项都作用在真实存在的机制上，界面文案必须说清「达到之后会发生什么」——
 * 用户看不见的静默降级比没有上限更难排查。
 */
export function RunLimitSettings({ settings, onSettingsChange }: {
  settings: AppSettings | null
  onSettingsChange: (patch: Partial<AppSettings>) => void
}) {
  if (!settings) return null
  const limits = settings.limits

  function patch(next: Partial<RunLimits>) {
    onSettingsChange({ limits: { ...limits, ...next } })
  }

  return <div className="settings-block">
    <h3>运行上限</h3>
    <div className="settings-field">
      <label htmlFor="limit-concurrent">同时运行的任务数</label>
      <input
        id="limit-concurrent"
        type="number"
        min={1}
        max={16}
        value={limits.maxConcurrentRuns}
        onChange={(event) => patch({ maxConcurrentRuns: Number(event.target.value) })}
      />
      <p className="settings-hint">超出后新任务排队等待，不会被丢弃。同一会话本来就串行执行，这里限制的是跨会话并发。</p>
    </div>
    <div className="settings-field">
      <label htmlFor="limit-empty-retries">空响应自动重试次数</label>
      <input
        id="limit-empty-retries"
        type="number"
        min={0}
        max={10}
        value={limits.maxEmptyRetries}
        onChange={(event) => patch({ maxEmptyRetries: Number(event.target.value) })}
      />
      <p className="settings-hint">模型返回空内容时的重试上限；设为 0 表示不重试，直接按失败结束这一轮。</p>
    </div>
    <div className="settings-field">
      <label htmlFor="limit-continuations">输出截断自动续写次数</label>
      <input
        id="limit-continuations"
        type="number"
        min={0}
        max={10}
        value={limits.maxLengthContinuations}
        onChange={(event) => patch({ maxLengthContinuations: Number(event.target.value) })}
      />
      <p className="settings-hint">单次输出达到长度上限时自动续写的次数；设为 0 表示不续写，回答会停在截断处。</p>
    </div>
    <div className="settings-field">
      <label htmlFor="limit-budget">单会话 token 预算</label>
      <input
        id="limit-budget"
        type="number"
        min={0}
        step={1000}
        placeholder="留空表示不限制"
        value={limits.conversationTokenBudget ?? ''}
        onChange={(event) => patch({ conversationTokenBudget: event.target.value.trim() ? Number(event.target.value) : null })}
      />
      {/* 只按服务商返回的实际用量判断，不做估算，也不换算成金额 */}
      <p className="settings-hint">按服务商返回的实际用量统计（输入 + 输出）。达到后该会话拒绝开新一轮，并说明已用量与预算；可调高预算或新建会话继续。</p>
    </div>
  </div>
}
