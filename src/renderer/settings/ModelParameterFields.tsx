import { useState } from 'react'
import { draftErrors, parseJsonField, type ModelParameterDraft } from './model-parameter-draft'

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
    <label className="settings-inline-field"><span>上下文窗口</span>
      <input type="number" min={1} value={draft.contextWindow} onChange={(event) => patch('contextWindow')(event.target.value)} placeholder={hint(placeholders?.contextWindow)} />
    </label>
    <label className="settings-inline-field"><span>最大输出 Tokens</span>
      <input type="number" min={1} value={draft.maxTokens} onChange={(event) => patch('maxTokens')(event.target.value)} placeholder={hint(placeholders?.maxTokens)} />
    </label>
    <label className="settings-inline-field"><span>模型类型</span>
      <select value={draft.modelKind} onChange={(event) => patch('modelKind')(event.target.value)}>
        <option value="">{placeholders?.modelKind ?? '跟随默认'}</option>
        <option value="chat">文本对话</option>
        <option value="multimodal">多模态（支持图片输入）</option>
      </select>
    </label>
    <label className="settings-inline-field"><span>Reasoning</span>
      <select value={draft.supportsThinking} onChange={(event) => patch('supportsThinking')(event.target.value)}>
        <option value="">{placeholders?.supportsThinking ?? '跟随默认'}</option>
        <option value="yes">支持思考</option>
        <option value="no">不支持</option>
      </select>
    </label>

    <div className="settings-section-heading local-model-advanced-heading">
      <button type="button" className="quick-secondary" onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen}>高级配置{advancedOpen ? ' ▴' : ' ▾'}</button>
      {onClear && <button type="button" className="small-control" onClick={onClear}>恢复默认</button>}
    </div>
    {advancedOpen && <>
      <label className="settings-inline-field"><span>温度</span>
        <input type="number" step={0.1} value={draft.temperature} onChange={(event) => patch('temperature')(event.target.value)} placeholder="如 0.7" />
      </label>
      <label className="settings-inline-field"><span>超时（秒）</span>
        <input type="number" min={1} value={draft.timeout} onChange={(event) => patch('timeout')(event.target.value)} placeholder="如 300" />
      </label>
      <label className="settings-inline-field"><span>重试次数</span>
        <input type="number" min={0} value={draft.maxRetries} onChange={(event) => patch('maxRetries')(event.target.value)} placeholder="如 2" />
      </label>
      <label className="settings-inline-field"><span>默认思考档位</span>
        <input value={draft.thinkingDefault} onChange={(event) => patch('thinkingDefault')(event.target.value)} placeholder="如 medium" spellCheck={false} />
      </label>
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
