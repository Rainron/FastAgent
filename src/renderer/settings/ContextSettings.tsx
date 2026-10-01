import { useRef, useState } from 'react'
import { ChevronRight, RotateCcw } from 'lucide-react'
import { CONTEXT_STRATEGY_PRESETS } from '../../shared/context-policy'
import type { AppSettings, ContextStrategy, ModelOption } from '../../shared/types'
import {
  TRIGGER_PERCENT_RANGE,
  applyEnabled,
  applyStrategy,
  applyTriggerPercent,
  buildContextSettingsView,
  clearRatioOverrides,
  contextWindowForModel,
  formatTokenCount,
  strategyDescription
} from './context-settings-view'

/** 关闭档不进档位选择器：开关本身已经表达了「关」，再列一次会出现两个关闭入口。 */
const selectableStrategies = CONTEXT_STRATEGY_PRESETS.filter((item) => item.value !== 'disabled')

export function ContextSettings({ settings, model, onChange }: { settings: AppSettings; model?: ModelOption | null; onChange: (patch: Partial<AppSettings>) => void }) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // 关闭前停在哪一档：主开关重新打开时交还给它，不让用户每次都重选。
  const lastStrategy = useRef<ContextStrategy>(settings.contextStrategy === 'disabled' ? 'auto' : settings.contextStrategy)
  if (settings.contextStrategy !== 'disabled') lastStrategy.current = settings.contextStrategy
  const contextWindow = contextWindowForModel(model)
  const view = buildContextSettingsView(settings, contextWindow, model?.model_name, model?.max_tokens)

  return <section className="settings-panel" aria-labelledby="settings-context">
    <div className="settings-section-heading"><div><h2 id="settings-context">上下文压缩</h2><p>会话接近模型窗口上限时，FastAgent 会把较早的回合压成结构化摘要，让任务继续跑下去。原始消息始终保留在本地，不会被删除。</p></div></div>

    <div className="settings-row">
      <div><strong>自动压缩上下文</strong><span>{view.enabled ? '越过触发阈值时自动压缩，无需手动介入。' : '关闭后仅在输入框上方提示余量，需要手动执行「立即压缩」。'}</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={view.enabled} onChange={(event) => onChange(applyEnabled(settings, event.target.checked, lastStrategy.current))} aria-label="自动压缩上下文" />
        <span className="switch-visual" />
      </label>
    </div>

    {view.enabled && <>
      <div className="settings-row settings-row-stack">
        <div><strong>压缩风格</strong><span>{view.custom ? '已手动调整阈值，当前不跟随任何档位。' : strategyDescription(view.strategy)}</span></div>
        <div className="reasoning-segmented settings-segmented" role="group" aria-label="压缩风格">
          {selectableStrategies.map((item) => <button
            key={item.value}
            className={!view.custom && settings.contextStrategy === item.value ? 'active' : ''}
            onClick={() => onChange(applyStrategy(settings, item.value))}
            aria-pressed={!view.custom && settings.contextStrategy === item.value}
          >{item.label}</button>)}
        </div>
      </div>

      <ContextRatioSlider
        label="触发阈值"
        hint={`上下文达到 ${formatTokenCount(view.triggerTokens)} 时开始压缩，压到约 ${formatTokenCount(view.targetTokens)}`}
        value={view.triggerPercent}
        min={TRIGGER_PERCENT_RANGE.min}
        max={TRIGGER_PERCENT_RANGE.max}
        onChange={(percent) => onChange(applyTriggerPercent(settings, percent))}
      />

      <div className="settings-effective" role="status">
        <span>当前生效</span>
        <strong>{view.effectiveLabel}</strong>
        {view.custom && <button type="button" className="text-button" onClick={() => onChange(clearRatioOverrides(settings))}><RotateCcw size={12} />恢复档位默认</button>}
      </div>
    </>}

    {!view.enabled && <div className="settings-effective" role="status"><span>当前生效</span><strong>{view.effectiveLabel}</strong></div>}

    <button className={`settings-advanced-toggle ${advancedOpen ? 'open' : ''}`} onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}>
      <ChevronRight size={14} />高级设置
    </button>
    {advancedOpen && <div className="settings-advanced">
      {/* 只有开着自动压缩才谈得上「压不动」：关闭档根本不会触发，这个开关摆出来只会误导。 */}
      {view.enabled && <label className="settings-advanced-switch">
        <span>压不动时强制压缩</span>
        <span className="switch-row">
          <input
            type="checkbox"
            checked={settings.forceCompaction}
            onChange={(event) => onChange({ forceCompaction: event.target.checked })}
            aria-label="压不动时强制压缩"
          />
          <span className="switch-visual" />
        </span>
        <small>
          越过触发阈值但常规压缩腾不出空间时，先收缩保留区重压一次；仍不行就按回合切摘要并重开会话。
          能避免上下文卡在上限附近压不下去，代价是丢掉更多近期原文。默认关闭。
        </small>
      </label>}
      <label>
        <span>换模型时保留的回合数</span>
        <input
          type="number"
          min={2}
          max={50}
          step={1}
          value={settings.keepRecentTurns === null ? '' : settings.keepRecentTurns}
          placeholder="默认 8"
          onChange={(event) => {
            const value = Number(event.target.value)
            onChange({ keepRecentTurns: event.target.value === '' || Number.isNaN(value) ? null : Math.min(50, Math.max(2, Math.round(value))) })
          }}
        />
        <small>只作用于跨服务商换模型时的回合摘要：会话必须重开，这些最近回合会原样带过去。常规压缩按 token 保留，不看回合数。</small>
      </label>
      <p className="settings-advanced-note">单条会话可以在「会话详情 › 上下文策略」里单独覆盖这里的设置。</p>
    </div>}
  </section>
}

/** 百分比滑杆 + 绝对量提示：只给百分比，用户判断不出还能装多少内容。 */
function ContextRatioSlider({ label, hint, value, min, max, onChange }: { label: string; hint: string; value: number; min: number; max: number; onChange: (percent: number) => void }) {
  return <div className="settings-row settings-row-stack settings-slider-row">
    <div><strong>{label}</strong><span>{hint}</span></div>
    <div className="settings-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={Math.min(max, Math.max(min, value))}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        aria-valuetext={`${value}%`}
      />
      <output>{value}%</output>
    </div>
  </div>
}
