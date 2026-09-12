import { useState } from 'react'
import { X } from 'lucide-react'
import type { LocalModelApi, LocalModelInput, LocalModelSummary } from '../../shared/types'

interface Props {
  /** null 表示新增；传入既有模型时表单回填且 api_key / headers 留空表示不修改。 */
  initial: LocalModelSummary | null
  onClose: () => void
  onSave: (input: LocalModelInput) => Promise<void>
}

const PROTOCOL_OPTIONS: Array<{ value: LocalModelApi; label: string; hint: string }> = [
  { value: 'openai', label: 'OpenAI 兼容', hint: 'Ollama / vLLM / DeepSeek / Qwen / GLM / LM Studio 等' },
  { value: 'anthropic', label: 'Anthropic', hint: '原生 Claude API 或 Anthropic 兼容网关' },
  { value: 'openai-responses', label: 'OpenAI Responses', hint: 'OpenAI 新一代 Responses API' }
]

/** JSON 文本解析：合法返回对象，非法返回错误文案。 */
function parseJsonField(value: string): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const text = value.trim()
  if (!text) return { ok: true, data: {} }
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: '必须是 JSON 对象，如 {"key": "value"}' }
    return { ok: true, data: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, error: 'JSON 格式不正确' }
  }
}

function positiveIntOrUndefined(value: string): number | undefined {
  const parsed = Number(value)
  return value.trim() && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function optionalNumber(value: string): number | undefined {
  const parsed = Number(value)
  return value.trim() && !Number.isNaN(parsed) ? parsed : undefined
}

/**
 * 本地模型新增 / 编辑表单。字段按 pi 运行时能力分层：
 * 基础（连接信息）、参数（采样与上下文）、高级（供应商差异化配置）。
 */
export function LocalModelDialog({ initial, onClose, onSave }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [protocol, setProtocol] = useState<LocalModelApi>(initial?.protocol ?? (initial?.provider === 'anthropic' || initial?.provider === 'openai-responses' || initial?.provider === 'openai' ? initial.provider : 'openai'))
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? '')
  const [modelName, setModelName] = useState(initial?.model_name ?? '')
  const [apiKey, setApiKey] = useState('')
  const [modelKind, setModelKind] = useState<'chat' | 'multimodal'>(initial?.model_kind ?? 'chat')
  const [contextWindow, setContextWindow] = useState(initial?.context_window ? String(initial.context_window) : '')
  const [maxTokens, setMaxTokens] = useState(initial?.max_tokens ? String(initial.max_tokens) : '')
  const [temperature, setTemperature] = useState(initial?.temperature !== undefined ? String(initial.temperature) : '')
  const [timeout, setTimeoutValue] = useState(initial?.timeout ? String(initial.timeout) : '')
  const [maxRetries, setMaxRetries] = useState(initial?.max_retries !== undefined ? String(initial.max_retries) : '')
  const [supportsThinking, setSupportsThinking] = useState(Boolean(initial?.supports_thinking))
  const [headersText, setHeadersText] = useState('')
  const [extraBodyText, setExtraBodyText] = useState(initial?.extra_body && Object.keys(initial.extra_body).length ? JSON.stringify(initial.extra_body, null, 2) : '')
  const [compatText, setCompatText] = useState(initial?.compat && Object.keys(initial.compat).length ? JSON.stringify(initial.compat, null, 2) : '')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const headers = parseJsonField(headersText)
  const extraBody = parseJsonField(extraBodyText)
  const compat = parseJsonField(compatText)

  const baseUrlError = baseUrl.trim() && !/^https?:\/\//i.test(baseUrl.trim()) ? 'Base URL 必须以 http:// 或 https:// 开头' : null

  const canSave = Boolean(name.trim() && modelName.trim() && baseUrl.trim() && !baseUrlError && headers.ok && extraBody.ok && compat.ok) && !saving

  async function handleSave() {
    // 类型守卫：同时把三个 JSON 字段窄化为已解析对象
    if (!headers.ok || !extraBody.ok || !compat.ok) return
    if (!canSave) return
    setError(null)
    setSaving(true)
    const input: LocalModelInput = {
      name: name.trim(),
      provider: name.trim(),
      protocol,
      model_name: modelName.trim(),
      model_kind: modelKind,
      base_url: baseUrl.trim().replace(/\/+$/, ''),
      // 编辑时留空视为不修改；显式勾选清空才传空串
      api_key: apiKey.trim() || (initial && !apiKey ? undefined : ''),
      // headers 无回填通道，留空一律视为不修改
      headers: headersText.trim() ? (headers.data as Record<string, string>) : undefined,
      context_window: positiveIntOrUndefined(contextWindow),
      max_tokens: positiveIntOrUndefined(maxTokens),
      temperature: optionalNumber(temperature),
      timeout: positiveIntOrUndefined(timeout),
      max_retries: positiveIntOrUndefined(maxRetries),
      supports_thinking: supportsThinking,
      extra_body: Object.keys(extraBody.data).length ? extraBody.data : null,
      compat: Object.keys(compat.data).length ? compat.data : null
    }
    try {
      await onSave(input)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSaving(false)
    }
  }

  return <div className="cap-drawer-layer" role="presentation">
    <div className="cap-overlay" onClick={onClose} />
    <div className="cap-drawer local-model-drawer" role="dialog" aria-label={initial ? '编辑本地模型' : '添加本地模型'}>
      <div className="cap-drawer-header">
        <div><strong>{initial ? `编辑本地模型：${initial.name}` : '添加本地模型'}</strong><small>直连自建网关或第三方 API，配置只保存在本机</small></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={15} /></button>
      </div>
      <div className="cap-drawer-body">
        <div className="cap-form">
          <div className="settings-section-heading"><div><h3>连接</h3><p>Base URL 与协议决定请求发往哪里。</p></div></div>
          <label className="settings-inline-field"><span>提供商 *</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ollama" /></label>
          <label className="settings-inline-field"><span>协议</span>
            <select value={protocol} onChange={(event) => setProtocol(event.target.value as LocalModelApi)}>
              {PROTOCOL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {PROTOCOL_OPTIONS.find((option) => option.value === protocol) && <p className="cap-field-note">{PROTOCOL_OPTIONS.find((option) => option.value === protocol)?.hint}</p>}
          <label className="settings-inline-field"><span>Base URL *</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:11434/v1" /></label>
          {baseUrlError && <p className="cap-field-note local-model-error">{baseUrlError}</p>}
          <label className="settings-inline-field"><span>模型名 *</span><input value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="qwen2.5:7b" /></label>
          <label className="settings-inline-field"><span>API Key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={initial ? '留空保持不变' : '本地推理可留空'} autoComplete="off" /></label>
          <label className="settings-inline-field"><span>模型类型</span>
            <select value={modelKind} onChange={(event) => setModelKind(event.target.value as 'chat' | 'multimodal')}>
              <option value="chat">文本对话</option>
              <option value="multimodal">多模态（支持图片输入）</option>
            </select>
          </label>

          <div className="settings-section-heading"><div><h3>参数</h3><p>采样与上下文限制；留空使用默认值。</p></div></div>
          <label className="settings-inline-field"><span>上下文窗口</span><input type="number" min={1} value={contextWindow} onChange={(event) => setContextWindow(event.target.value)} placeholder="如 128000" /></label>
          <label className="settings-inline-field"><span>最大输出 Tokens</span><input type="number" min={1} value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} placeholder="如 8192" /></label>
          <label className="settings-inline-field"><span>温度</span><input type="number" min={0} step={0.1} value={temperature} onChange={(event) => setTemperature(event.target.value)} placeholder="如 0.7" /></label>
          <label className="settings-inline-field"><span>超时（秒）</span><input type="number" min={1} value={timeout} onChange={(event) => setTimeoutValue(event.target.value)} placeholder="如 300" /></label>
          <label className="settings-inline-field"><span>重试次数</span><input type="number" min={0} value={maxRetries} onChange={(event) => setMaxRetries(event.target.value)} placeholder="如 2" /></label>
          <label className="switch-row">
            <input type="checkbox" checked={supportsThinking} onChange={(event) => setSupportsThinking(event.target.checked)} />
            <span className="switch-visual" />
            <span>支持思考（Reasoning）</span>
          </label>

          <div className="settings-section-heading local-model-advanced-heading">
            <button className="quick-secondary" onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen}>高级配置{advancedOpen ? ' ▴' : ' ▾'}</button>
          </div>
          {advancedOpen && <>
            <label className="settings-inline-field"><span>额外请求头 headers</span><textarea rows={2} value={headersText} onChange={(event) => setHeadersText(event.target.value)} placeholder='{"x-tenant": "my-org"}' spellCheck={false} /></label>
            {!headers.ok && headersText.trim() && <p className="cap-field-note local-model-error">{headers.error}</p>}
            <label className="settings-inline-field"><span>请求体扩展字段 extra_body</span><textarea rows={3} value={extraBodyText} onChange={(event) => setExtraBodyText(event.target.value)} placeholder='{"top_p": 0.8}' spellCheck={false} /></label>
            {!extraBody.ok && extraBodyText.trim() && <p className="cap-field-note local-model-error">{extraBody.error}</p>}
            <label className="settings-inline-field"><span>供应商兼容配置 compat</span><textarea rows={3} value={compatText} onChange={(event) => setCompatText(event.target.value)} placeholder='{"maxTokensField": "max_tokens"}' spellCheck={false} /></label>
            {!compat.ok && compatText.trim() && <p className="cap-field-note local-model-error">{compat.error}</p>}
            <p className="cap-field-note">常见 compat：DeepSeek 用 <code>{"maxTokensField: \"max_tokens\""}</code>，Qwen 思考模型用 <code>{"thinkingFormat: \"qwen\""}</code>，OpenRouter 可配 <code>openRouterRouting</code>。</p>
          </>}
          {error && <p className="cap-field-note local-model-error">{error}</p>}
        </div>
      </div>
      <div className="cap-drawer-footer">
        <button className="quick-secondary" onClick={onClose}>取消</button>
        <button className="primary-button" onClick={() => void handleSave()} disabled={!canSave}>{initial ? '保存修改' : '添加模型'}</button>
      </div>
    </div>
  </div>
}
