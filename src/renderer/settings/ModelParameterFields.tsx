import { useMemo, useState } from 'react'
import { Select } from '../components/Select'
import { draftErrors, parseJsonField, type ModelParameterDraft } from './model-parameter-draft'
import { CONTEXT_WINDOW_PRESETS, CUSTOM_PRESET, MAX_RETRIES_PRESETS, MAX_TOKENS_PRESETS, TEMPERATURE_PRESETS, THINKING_DEFAULT_PRESETS, TIMEOUT_PRESETS, presetSelection, presetValue, type ParameterPreset } from './model-parameter-presets'

/**
 * 每一项的来源说明。留空的输入框显示这里给的占位值与来源标签，
 * 用户才分得清「128000 是云端下发的」和「128000 只是猜的」。
 */
export interface ModelParameterPlaceholders {
  contextWindow?: { value: number; origin: string }
  maxTokens?: { value: number; origin: string }
  modelKind?: string
  supportsThinking?: string
}

/**
 * 常用挡位下拉 + 自定义输入。
 * 挡位覆盖主流规格（上下文 128K / 256K / 1M 这些），点一下就选中；
 * 挡位里没有的值自动落到「自定义」并把输入框露出来，不限制用户填任意数。
 */
function PresetField({ label, value, presets, placeholder, inputProps, onChange }: {
  label: string
  value: string
  presets: ParameterPreset[]
  placeholder: string
  inputProps?: { type?: 'number' | 'text'; min?: number; step?: number }
  onChange: (next: string) => void
}) {
  const selection = presetSelection(value, presets)
  // 「自定义」是用户的显式选择：值被清空后仍要留着输入框，否则刚选中就弹回下拉。
  const [custom, setCustom] = useState(false)
  const showInput = selection === CUSTOM_PRESET || custom
  const options = useMemo(() => [
    ...presets.map((preset) => ({ value: preset.value, label: preset.label })),
    { value: CUSTOM_PRESET, label: '自定义…', description: '填任意数值' }
  ], [presets])
  return <div className="settings-inline-field model-preset-field">
    <span>{label}</span>
    <div className="model-preset-controls">
      <Select
        value={showInput && selection !== CUSTOM_PRESET ? CUSTOM_PRESET : selection}
        options={options}
        placeholder={placeholder}
        ariaLabel={label}
        onChange={(next) => {
          setCustom(next === CUSTOM_PRESET)
          onChange(presetValue(next, value))
        }}
      />
      {showInput && <input
        type={inputProps?.type ?? 'number'}
        min={inputProps?.min}
        step={inputProps?.step}
        value={value}
        aria-label={`${label}（自定义）`}
        placeholder="自定义值"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />}
    </div>
  </div>
}

/**
 * 模型参数编辑面板。纯受控，不碰 window.fastAgent：连接内模型与云端模型覆盖
 * 共用这一个组件，差别只在调用方把草稿提交去哪里。
 */
export function ModelParameterFields({ draft, placeholders, onChange, onClear }: {
  draft: ModelParameterDraft
  placeholders?: ModelParameterPlaceholders
  onChange: (next: ModelParameterDraft) => void
  /** 提供时显示「恢复默认」；清空全部字段由调用方决定语义（删覆盖 / 回落连接默认）。 */
  onClear?: () => void
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const errors = draftErrors(draft)
  const extraBody = parseJsonField(draft.extraBody)
  const compat = parseJsonField(draft.compat)
  const patch = (key: keyof ModelParameterDraft) => (value: string) => onChange({ ...draft, [key]: value })
  const hint = (source?: { value: number; origin: string }) => source ? `${source.value}（${source.origin}）` : '留空使用默认值'

  return <div className="model-parameter-fields">
    <PresetField label="上下文窗口" value={draft.contextWindow} presets={CONTEXT_WINDOW_PRESETS} placeholder={hint(placeholders?.contextWindow)} inputProps={{ min: 1 }} onChange={patch('contextWindow')} />
    <PresetField label="最大输出 Tokens" value={draft.maxTokens} presets={MAX_TOKENS_PRESETS} placeholder={hint(placeholders?.maxTokens)} inputProps={{ min: 1 }} onChange={patch('maxTokens')} />
    <div className="settings-inline-field"><span>模型类型</span>
      <Select
        value={draft.modelKind}
        options={[{ value: 'chat', label: '文本对话' }, { value: 'multimodal', label: '多模态', description: '支持图片输入' }]}
        placeholder={placeholders?.modelKind ?? '跟随默认'}
        ariaLabel="模型类型"
        onChange={patch('modelKind')}
      />
    </div>
    <div className="settings-inline-field"><span>Reasoning</span>
      <Select
        value={draft.supportsThinking}
        options={[{ value: 'yes', label: '支持思考' }, { value: 'no', label: '不支持' }]}
        placeholder={placeholders?.supportsThinking ?? '跟随默认'}
        ariaLabel="Reasoning"
        onChange={patch('supportsThinking')}
      />
    </div>

    <div className="settings-section-heading local-model-advanced-heading">
      <button type="button" className="quick-secondary" onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen}>高级配置{advancedOpen ? ' ▴' : ' ▾'}</button>
      {onClear && <button type="button" className="small-control" onClick={onClear}>恢复默认</button>}
    </div>
    {advancedOpen && <>
      <PresetField label="温度" value={draft.temperature} presets={TEMPERATURE_PRESETS} placeholder="留空使用默认值" inputProps={{ step: 0.1 }} onChange={patch('temperature')} />
      <PresetField label="超时（秒）" value={draft.timeout} presets={TIMEOUT_PRESETS} placeholder="留空使用默认值" inputProps={{ min: 1 }} onChange={patch('timeout')} />
      <PresetField label="重试次数" value={draft.maxRetries} presets={MAX_RETRIES_PRESETS} placeholder="留空使用默认值" inputProps={{ min: 0 }} onChange={patch('maxRetries')} />
      <PresetField label="默认思考档位" value={draft.thinkingDefault} presets={THINKING_DEFAULT_PRESETS} placeholder="跟随默认" inputProps={{ type: 'text' }} onChange={patch('thinkingDefault')} />
      <label className="settings-inline-field"><span>请求体扩展字段 extra_body</span>
        <textarea rows={3} value={draft.extraBody} onChange={(event) => patch('extraBody')(event.target.value)} placeholder='{"top_p": 0.8}' spellCheck={false} />
      </label>
      {!extraBody.ok && <p className="cap-field-note local-model-error">{extraBody.error}</p>}
      <label className="settings-inline-field"><span>供应商兼容配置 compat</span>
        <textarea rows={3} value={draft.compat} onChange={(event) => patch('compat')(event.target.value)} placeholder='{"maxTokensField": "max_tokens"}' spellCheck={false} />
      </label>
      {!compat.ok && <p className="cap-field-note local-model-error">{compat.error}</p>}
      <p className="cap-field-note">常见 compat：DeepSeek 用 <code>{"maxTokensField: \"max_tokens\""}</code>，Qwen 思考模型用 <code>{"thinkingFormat: \"qwen\""}</code>，OpenRouter 可配 <code>openRouterRouting</code>。</p>
    </>}
    {errors.length > 0 && <p className="cap-field-note local-model-error" role="alert">{errors[0]}</p>}
  </div>
}
