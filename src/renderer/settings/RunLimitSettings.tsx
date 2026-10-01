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

  return <section className="settings-panel" aria-labelledby="settings-run-limits">
    <div className="settings-section-heading"><div><h2 id="settings-run-limits">运行上限</h2><p>控制并发、自动重试与单会话预算，达到上限后的行为都写在每项说明里。</p></div></div>
    <div className="settings-row">
      <div>
        <strong>同时运行的任务数</strong>
        <span>超出后新任务排队等待，不会被丢弃。同一会话本来就串行执行，这里限制的是跨会话并发。</span>
      </div>
      <input
        className="settings-number-input"
        type="number"
        min={1}
        max={16}
        value={limits.maxConcurrentRuns}
        onChange={(event) => patch({ maxConcurrentRuns: Number(event.target.value) })}
        aria-label="同时运行的任务数"
      />
    </div>
    <div className="settings-row">
      <div>
        <strong>空响应自动重试次数</strong>
        <span>模型返回空内容时的重试上限；设为 0 表示不重试，直接按失败结束这一轮。</span>
      </div>
      <input
        className="settings-number-input"
        type="number"
        min={0}
        max={10}
        value={limits.maxEmptyRetries}
        onChange={(event) => patch({ maxEmptyRetries: Number(event.target.value) })}
        aria-label="空响应自动重试次数"
      />
    </div>
    <div className="settings-row">
      <div>
        <strong>输出截断自动续写次数</strong>
        <span>单次输出达到长度上限时自动续写的次数；设为 0 表示不续写，回答会停在截断处。</span>
      </div>
      <input
        className="settings-number-input"
        type="number"
        min={0}
        max={10}
        value={limits.maxLengthContinuations}
        onChange={(event) => patch({ maxLengthContinuations: Number(event.target.value) })}
        aria-label="输出截断自动续写次数"
      />
    </div>
    <div className="settings-row">
      <div>
        <strong>单会话 token 预算</strong>
        {/* 只按服务商返回的实际用量判断，不做估算，也不换算成金额 */}
        <span>按服务商返回的实际用量统计（输入 + 输出）。达到后该会话拒绝开新一轮，并说明已用量与预算；可调高预算或新建会话继续。</span>
      </div>
      <input
        className="settings-number-input wide"
        type="number"
        min={0}
        step={1000}
        placeholder="不限制"
        value={limits.conversationTokenBudget ?? ''}
        onChange={(event) => patch({ conversationTokenBudget: event.target.value.trim() ? Number(event.target.value) : null })}
        aria-label="单会话 token 预算"
      />
    </div>
  </section>
}
