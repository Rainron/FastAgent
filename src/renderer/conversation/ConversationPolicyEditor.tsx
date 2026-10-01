import { CONTEXT_STRATEGY_PRESETS, contextStrategyPreset, effectiveContextPolicy } from '../../shared/context-policy'
import type { ContextPolicy, ContextStrategy } from '../../shared/types'
import { formatTokenCount } from '../settings/context-settings-view'

/** 关闭档由「自动压缩」开关表达，档位选择器里不再重复列一次。 */
const selectableStrategies = CONTEXT_STRATEGY_PRESETS.filter((item) => item.value !== 'disabled')

export interface ConversationPolicyView {
  strategy: ContextStrategy
  autoSummary: boolean
  triggerRatio: number | null
  forceCompaction: boolean
  inheritGlobal: boolean
}

/**
 * 单条会话的压缩策略覆盖。
 * 默认跟随全局；打开覆盖后这条会话就不再受设置页影响，这一点必须在界面上说清楚，
 * 否则用户会在设置页反复改却对这条会话没有任何效果。
 */
export function ConversationPolicyEditor({ policy, contextWindow, maxTokens, disabled, onChange }: {
  policy: ConversationPolicyView
  contextWindow: number
  /**
   * 模型单次输出上限，摘要预算按它估。不传的话这里会按 8192 的缺省值算，
   * 而设置页传的是模型真实值——同一条会话在两个界面上会显示两个不同的「压到 X%」。
   */
  maxTokens?: number | null
  /** 正在压缩时不允许改策略：改完立刻生效会和进行中的压缩打架。 */
  disabled?: boolean
  onChange: (patch: Partial<Omit<ContextPolicy, 'conversationId'>>) => void
}) {
  const effective = effectiveContextPolicy(policy, contextWindow, maxTokens)
  const overridden = !policy.inheritGlobal
  return <div className="policy-editor">
    <label className="policy-editor-row">
      <span><strong>单独设置这条会话</strong><small>{overridden ? '这条会话不受设置页影响。' : '当前跟随「设置 › 对话与上下文」。'}</small></span>
      <span className="switch-row">
        <input
          type="checkbox"
          checked={overridden}
          disabled={disabled}
          onChange={(event) => onChange({ inheritGlobal: !event.target.checked })}
          aria-label="单独设置这条会话的压缩策略"
        />
        <span className="switch-visual" />
      </span>
    </label>

    {overridden && <>
      <label className="policy-editor-row">
        <span><strong>自动压缩</strong><small>{effective.enabled ? '越过阈值时自动压缩。' : '只提示，不自动压缩。'}</small></span>
        <span className="switch-row">
          <input
            type="checkbox"
            checked={effective.enabled}
            disabled={disabled}
            onChange={(event) => onChange({ strategy: event.target.checked ? (policy.strategy === 'disabled' ? 'auto' : policy.strategy) : 'disabled' })}
            aria-label="这条会话自动压缩"
          />
          <span className="switch-visual" />
        </span>
      </label>

      {effective.enabled && <>
        <div className="policy-editor-row stack">
          <span><strong>压缩风格</strong><small>{contextStrategyPreset(policy.strategy).description}</small></span>
          <div className="reasoning-segmented settings-segmented" role="group" aria-label="这条会话的压缩风格">
            {selectableStrategies.map((item) => <button
              key={item.value}
              className={policy.strategy === item.value ? 'active' : ''}
              disabled={disabled}
              onClick={() => onChange({ strategy: item.value, triggerRatio: null })}
              aria-pressed={policy.strategy === item.value}
            >{item.label}</button>)}
          </div>
        </div>
        <label className="policy-editor-row">
          <span><strong>压不动时强制压缩</strong><small>{policy.forceCompaction ? '腾不出空间时收缩保留区重压，仍不行按回合摘要重开。' : '常规压缩腾不出空间时只提示，不强压。'}</small></span>
          <span className="switch-row">
            <input
              type="checkbox"
              checked={policy.forceCompaction}
              disabled={disabled}
              onChange={(event) => onChange({ forceCompaction: event.target.checked })}
              aria-label="这条会话压不动时强制压缩"
            />
            <span className="switch-visual" />
          </span>
        </label>

        {/* 百分比取换算后真正生效的那组：阈值可能被收敛约束夹过，照设定值显示等于骗人。 */}
        <div className="policy-editor-effective">
          触发 {Math.round(effective.effectiveTriggerRatio * 100)}%（{formatTokenCount(effective.triggerTokens)}） · 压到 {Math.round(effective.effectiveTargetRatio * 100)}%（{formatTokenCount(effective.targetTokens)}）
          {effective.clamped && <small>为保证压缩能收敛，已按上面的实际值执行</small>}
        </div>
      </>}
    </>}
  </div>
}
