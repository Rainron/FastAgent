import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Plus, Trash2 } from 'lucide-react'
import type { LocalModelApi } from '../../shared/types'
import { addModel, connectionDraft } from './form-state'
import './model-connections.css'

type Api = Window['fastAgent']['modelConnections']
type Connection = Awaited<ReturnType<Api['list']>>[number]
type Provider = Awaited<ReturnType<Api['providers']>>[number]
type Login = Awaited<ReturnType<Api['startLogin']>>
type Input = Parameters<Api['save']>[0]

export const MODEL_CONNECTIONS_CHANGED = 'fastagent:model-connections-changed'

export function ModelConnections({ entering = false, selectedModelId, onSelectModel, onChanged }: {
  entering?: boolean
  selectedModelId?: number | null
  onSelectModel?: (id: number) => void
  onChanged?: (connections: Connection[]) => void
}) {
  const [connections, setConnections] = useState<Connection[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const changedRef = useRef(onChanged)
  changedRef.current = onChanged

  async function load() {
    setError('')
    setLoading(true)
    try {
      const [items, presets] = await Promise.all([window.fastAgent.modelConnections.list(), window.fastAgent.modelConnections.providers()])
      setConnections(items)
      setProviders(presets)
      setSelected((value) => items.some((item) => item.id === value) ? value : items[0]?.id ?? null)
      changedRef.current?.(items)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '模型服务加载失败') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  async function changed(id?: string) {
    await load()
    if (id) setSelected(id)
    setAdding(false)
    setRevision((value) => value + 1)
    window.dispatchEvent(new Event(MODEL_CONNECTIONS_CHANGED))
  }

  const current = adding ? null : connections.find((item) => item.id === selected) ?? null
  return <div className={`model-connections ${entering ? 'model-connections-entry' : ''}`}>
    {error && <p role="alert">{error} <button type="button" className="small-control" onClick={() => void load()}>重试</button></p>}
    {loading && !providers.length ? <p role="status"><LoaderCircle size={14} className="spin" />正在加载模型服务…</p> : providers.length > 0 && <>
      {connections.length > 0 && <nav className="model-connection-list" aria-label="已配置的模型服务">
        {connections.map((connection) => <button type="button" key={connection.id} aria-current={!adding && connection.id === selected} onClick={() => { setSelected(connection.id); setAdding(false) }}>
          <strong>{connection.name}</strong><small>{providers.find((provider) => provider.id === connection.providerId)?.name ?? connection.providerId} · {connection.models.length} 个模型</small>
        </button>)}
        <button type="button" onClick={() => setAdding(true)}><Plus size={14} />添加模型服务</button>
      </nav>}
      <ConnectionForm key={`${current?.id ?? 'new'}-${revision}`} initial={current} providers={providers} entering={entering} selectedModelId={selectedModelId} onSelectModel={onSelectModel} onChanged={changed} />
    </>}
  </div>
}

function ConnectionForm({ initial, providers, entering, selectedModelId, onSelectModel, onChanged }: {
  initial: Connection | null
  providers: Provider[]
  entering: boolean
  selectedModelId?: number | null
  onSelectModel?: (id: number) => void
  onChanged: (id?: string) => Promise<void>
}) {
  const [mode, setMode] = useState<'oauth' | 'api-key' | null>(initial?.authMode ?? null)
  const [providerId, setProviderId] = useState(initial?.providerId ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [protocol, setProtocol] = useState<LocalModelApi>(initial?.protocol ?? 'openai')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<Input['models']>(initial?.models.map((model) => ({ id: model.id, modelId: model.model_name, name: model.name, contextWindow: model.context_window ?? undefined, maxTokens: model.max_tokens ?? undefined, reasoning: model.supports_thinking })) ?? [])
  const [modelId, setModelId] = useState('')
  const [discovered, setDiscovered] = useState<Awaited<ReturnType<Api['models']>>>([])
  const [login, setLogin] = useState<Login | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const loginRef = useRef<Login | null>(null)
  loginRef.current = login
  const provider = providers.find((item) => item.id === providerId)
  const connectionId = initial?.id ?? (login?.status === 'success' ? login.connectionId : undefined)
  const draft = connectionDraft({ id: connectionId, providerId, name, authMode: mode ?? 'api-key', baseUrl, apiKey, protocol })

  useEffect(() => () => {
    const active = loginRef.current
    if (active && (active.status === 'pending' || active.status === 'input-required')) void window.fastAgent.modelConnections.cancelLogin(active.sessionId).catch(() => {})
  }, [])

  useEffect(() => {
    if (!login || !['pending', 'input-required'].includes(login.status)) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void window.fastAgent.modelConnections.authState(login.sessionId).then((next) => { if (!cancelled) setLogin(next) }).catch((cause) => { if (!cancelled) { setError(cause instanceof Error ? cause.message : '授权状态获取失败'); setLogin({ ...login, status: 'error' }) } })
    }, 1000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [login])

  function chooseProvider(value: string) {
    const next = providers.find((item) => item.id === value)
    setProviderId(value)
    setName(next?.name ?? '')
    setBaseUrl(next?.baseUrl ?? '')
    setProtocol(next?.protocol ?? 'openai')
    setApiKey('')
    setModels([])
    setDiscovered(next?.models ?? [])
    setLogin(null)
    setMessage('')
    setError('')
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setMessage('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试') }
    finally { setBusy(false) }
  }

  async function save(enter: boolean) {
    if (!models.length) throw new Error('请至少添加一个模型')
    if (enter) {
      const result = await window.fastAgent.modelConnections.test({ ...draft, modelId: models[0].modelId })
      if (!result.ok) throw new Error(result.error ?? '模型连接测试失败')
    }
    const saved = await window.fastAgent.modelConnections.save({ ...draft, models })
    if (enter) await window.fastAgent.auth.enterWorkspace(saved.models[0]?.id)
    await onChanged(saved.id)
  }

  const authorizing = login?.status === 'pending' || login?.status === 'input-required'
  return <div className="model-connection-detail">
    {!initial && <>
      <h3>连接模型服务</h3>
      <p className="settings-hint">选择登录方式，再选择模型厂商。</p>
      <div className="model-auth-methods">
        <button type="button" aria-pressed={mode === 'oauth'} disabled={busy || authorizing} onClick={() => { setMode('oauth'); chooseProvider('') }}><strong>使用账号登录</strong><small>Sign in with an account</small></button>
        <button type="button" aria-pressed={mode === 'api-key'} disabled={busy || authorizing} onClick={() => { setMode('api-key'); chooseProvider('') }}><strong>使用 API Key 登录</strong><small>Sign in with an API key</small></button>
      </div>
      {mode && <label className="model-connection-field">模型厂商<select value={providerId} disabled={busy || authorizing} onChange={(event) => chooseProvider(event.target.value)}><option value="">选择厂商</option>{providers.filter((item) => item.authModes.includes(mode)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    </>}
    {provider && <form onSubmit={(event) => { event.preventDefault(); void run(() => save(entering)) }}>
      <fieldset disabled={busy || authorizing}>
        {initial && <h3>{provider.name}</h3>}
        <label className="model-connection-field">连接名称<input required value={name} onChange={(event) => setName(event.target.value)} placeholder={`${provider.name} · 工作`} /></label>
        {mode === 'api-key' && <>
          <label className="model-connection-field">Base URL<input type="url" required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} /></label>
          <label className="model-connection-field">接口协议<select value={protocol} onChange={(event) => setProtocol(event.target.value as LocalModelApi)}><option value="openai">OpenAI 兼容</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic">Anthropic</option></select></label>
          <label className="model-connection-field">API Key<input type="password" autoComplete="new-password" value={apiKey} required={!initial?.hasCredentials} onChange={(event) => setApiKey(event.target.value)} placeholder={initial?.hasCredentials ? '留空保留已保存的密钥' : '输入厂商 API Key'} /></label>
        </>}
        {mode === 'oauth' && <div className="model-connection-actions">
          <button type="button" className="quick-secondary" onClick={() => void run(async () => { setLogin(await window.fastAgent.modelConnections.startLogin(providerId, initial?.id)) })}>{initial?.hasCredentials || login?.status === 'success' ? '重新登录账号' : '在浏览器中登录'}</button>
          {initial?.hasCredentials && <button type="button" className="small-control" onClick={() => void run(async () => { await window.fastAgent.modelConnections.logout(initial.id); await onChanged(initial.id) })}>退出此账号</button>}
        </div>}
      </fieldset>
      {login && <div className="model-login-status" role="status">
        <p>{login.status === 'success' ? '账号授权成功，可以选择模型。' : login.error ?? login.message ?? (login.status === 'pending' ? '请在系统浏览器完成授权…' : login.status === 'cancelled' ? '已取消授权' : login.status === 'expired' ? '授权已过期，请重新登录' : '等待账号授权')}</p>
        {login.url && <p className="model-login-url">授权地址：{login.url}</p>}
        {login.userCode && <p>设备验证码：<strong>{login.userCode}</strong></p>}
        {login.status === 'input-required' && login.prompt?.options && <div className="model-connection-actions">{login.prompt.options.map((option) => <button type="button" className="small-control" disabled={busy} key={option.id} onClick={() => void run(async () => { await window.fastAgent.modelConnections.answerLogin(login.sessionId, option.id); setLogin(await window.fastAgent.modelConnections.authState(login.sessionId)) })}>{option.label}</button>)}</div>}
        {login.status === 'input-required' && <label className="model-connection-field">{login.prompt?.message ?? '输入验证码'}<input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={login.prompt?.placeholder} /><button type="button" className="small-control" disabled={busy || (!answer.trim() && !login.prompt?.allowEmpty)} onClick={() => void run(async () => { await window.fastAgent.modelConnections.answerLogin(login.sessionId, answer); setAnswer(''); setLogin(await window.fastAgent.modelConnections.authState(login.sessionId)) })}>提交验证码</button></label>}
        {authorizing && <button type="button" className="small-control" onClick={() => void run(async () => { await window.fastAgent.modelConnections.cancelLogin(login.sessionId); setLogin({ ...login, status: 'cancelled' }) })}>取消授权</button>}
      </div>}
      <fieldset disabled={busy || authorizing}>
        <div className="model-connection-model-heading"><h4>连接内模型</h4><button type="button" className="small-control" onClick={() => void run(async () => { const items = await window.fastAgent.modelConnections.models(draft); setDiscovered(items); setMessage(items.length ? `获取到 ${items.length} 个模型，请选择添加。` : '没有获取到模型，请手动输入模型 ID。') })}>获取模型</button></div>
        {discovered.length > 0 && <label className="model-connection-field">可用模型<select value="" onChange={(event) => { const model = discovered.find((item) => item.modelId === event.target.value); if (model && !models.some((item) => item.modelId === model.modelId)) setModels([...models, model]) }}><option value="">选择模型添加到连接</option>{discovered.map((item) => <option key={item.modelId} value={item.modelId} disabled={models.some((model) => model.modelId === item.modelId)}>{item.name ?? item.modelId}</option>)}</select></label>}
        <div className="model-connection-add"><label className="model-connection-field">模型 ID<input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="手动输入模型 ID" spellCheck={false} /></label><button type="button" className="small-control" disabled={!modelId.trim()} onClick={() => { setModels(addModel(models, modelId)); setModelId('') }}>添加</button></div>
        <ul className="model-connection-models">{models.map((model) => <li key={model.modelId}><span><strong>{model.name ?? model.modelId}</strong><small>{model.modelId}</small></span><div className="model-connection-actions">
          <button type="button" className="small-control" onClick={() => void run(async () => { const result = await window.fastAgent.modelConnections.test({ ...draft, modelId: model.modelId }); if (!result.ok) throw new Error(result.error ?? '连接失败'); setMessage(`连接成功（${result.latencyMs ?? '—'} ms）`) })}>测试</button>
          {model.id !== undefined && <button type="button" className="small-control" disabled={model.id === selectedModelId} onClick={() => void run(async () => { if (entering) await window.fastAgent.auth.enterWorkspace(model.id); else onSelectModel?.(model.id!) })}>{entering ? '进入工作区' : model.id === selectedModelId ? '使用中' : '设为当前模型'}</button>}
          <button type="button" className="small-control" aria-label={`移除模型 ${model.modelId}`} onClick={() => setModels(models.filter((item) => item.modelId !== model.modelId))}><Trash2 size={13} /></button>
        </div></li>)}</ul>
        <div className="model-connection-actions"><button className="primary-button" type="submit" disabled={!models.length || (mode === 'oauth' && !initial?.hasCredentials && login?.status !== 'success')}>{entering ? '测试并进入工作区' : '保存模型服务'}</button>{initial && <button type="button" className="small-control danger" onClick={() => setConfirmDelete(true)}>删除连接</button>}</div>
      </fieldset>
    </form>}
    {confirmDelete && initial && <div className="model-connection-delete" role="alert"><p>删除“{initial.name}”及其中 {initial.models.length} 个模型？历史会话会保留。</p><button type="button" className="small-control danger" disabled={busy} onClick={() => void run(async () => { await window.fastAgent.modelConnections.remove(initial.id); await onChanged() })}>确认删除连接和 {initial.models.length} 个模型</button><button type="button" className="small-control" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button></div>}
    {busy && <p role="status"><LoaderCircle size={14} className="spin" />正在处理…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
  </div>
}
