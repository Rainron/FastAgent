import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AppSettings, ContextStrategy } from '../../shared/types'

const strategies: Array<{ value: ContextStrategy; label: string; description: string }> = [
  { value: 'auto', label: '自动', description: '推荐。约 72–82% 触发，压缩到 50–60%，结合工具输出和消息增长速度判断。' },
  { value: 'conservative', label: '保守', description: '约 85% 才触发，压缩到 65–70%。适合 Code、Debug 和长链路 Agent。' },
  { value: 'aggressive', label: '激进', description: '约 65–70% 触发，压缩到 40–50%。适合长聊天、文档讨论和成本敏感场景。' },
  { value: 'disabled', label: '关闭', description: '不自动压缩。接近上限时只显示警告，需要手动执行「立即压缩」。' }
]

/** 与主进程 contextTargetRatio 同一组档位；这里只用于输入框的占位提示。 */
export function strategyTargetRatio(strategy: ContextStrategy) {
  if (strategy === 'aggressive') return 0.45
  if (strategy === 'conservative') return 0.68
  if (strategy === 'disabled') return 1
  return 0.55
}

export function ContextSettings({ settings, onChange }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void }) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const active = strategies.find((item) => item.value === settings.contextStrategy) ?? strategies[0]
  return <section className="settings-panel" aria-labelledby="settings-context">
    <div className="settings-section-heading"><div><h2 id="settings-context">自动摘要与上下文压缩</h2><p>长会话接近模型上下文窗口时，FastAgent 会压缩旧回合。原始消息始终保留在本地，不会被删除。</p></div></div>
    <div className="settings-row">
      <div><strong>自动摘要</strong><span>在长对话中生成结构化阶段摘要。</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={settings.autoSummary} onChange={(event) => onChange({ autoSummary: event.target.checked })} aria-label="自动摘要" />
        <span className="switch-visual" />
      </label>
    </div>
    <div className="settings-row settings-row-stack">
      <div><strong>上下文压缩</strong><span>{active.description}</span></div>
      <div className="reasoning-segmented settings-segmented" role="group" aria-label="上下文压缩策略">
        {strategies.map((item) => <button key={item.value} className={settings.contextStrategy === item.value ? 'active' : ''} onClick={() => onChange({ contextStrategy: item.value })} aria-pressed={settings.contextStrategy === item.value}>{item.label}</button>)}
      </div>
    </div>
    <button className={`settings-advanced-toggle ${advancedOpen ? 'open' : ''}`} onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}>
      <ChevronRight size={14} />高级设置
    </button>
    {advancedOpen && <div className="settings-advanced">
      <label>
        <span>触发阈值</span>
        <input type="number" min={10} max={99} step={1} value={settings.triggerRatio === null ? '' : Math.round(settings.triggerRatio * 100)} placeholder={`跟随策略（${Math.round((settings.contextStrategy === 'aggressive' ? 0.68 : settings.contextStrategy === 'conservative' ? 0.85 : 0.78) * 100)}%）`} onChange={(event) => { const value = Number(event.target.value); onChange({ triggerRatio: event.target.value === '' || Number.isNaN(value) ? null : Math.min(0.99, Math.max(0.1, value / 100)) }) }} />
        <small>上下文使用率达到该百分比时触发压缩，留空则跟随所选策略。</small>
      </label>
      <label>
        <span>压缩后目标占比</span>
        <input type="number" min={10} max={95} step={1} value={settings.targetRatio === null ? '' : Math.round(settings.targetRatio * 100)} placeholder={`跟随策略（${Math.round(strategyTargetRatio(settings.contextStrategy) * 100)}%）`} onChange={(event) => { const value = Number(event.target.value); onChange({ targetRatio: event.target.value === '' || Number.isNaN(value) ? null : Math.min(0.95, Math.max(0.1, value / 100)) }) }} />
        <small>压缩后期望回落到的上下文使用率；越低保留的原文越少，留空则跟随所选策略。</small>
      </label>
    </div>}
  </section>
}
