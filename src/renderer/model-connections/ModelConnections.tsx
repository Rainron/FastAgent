import { useEffect, useRef, useState } from 'react'
import { Download, Eye, EyeOff, LoaderCircle, Plus, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
import type { DiscoveredConnectionModel, LocalModelApi } from '../../shared/types'
import { ModelParameterFields } from '../settings/ModelParameterFields'
import { connectionPatchFromDraft, draftFromSource, type ModelParameterDraft } from '../settings/model-parameter-draft'
import { inferContextWindow } from '../../shared/model-context-windows'
import { addModel, connectionDraft, mergeModels, selectConnectionId, type ModelConnectionFocus } from './form-state'
import { CenterDialog } from '../components/CenterDialog'
import { ConnectionExportDialog } from './ConnectionExportDialog'
import { ConnectionImportDialog } from './ConnectionImportDialog'
import { DiscoveredModelsDialog } from './DiscoveredModelsDialog'
import './model-connections.css'

type Api = Window['fastAgent']['modelConnections']
type Connection = Awaited<ReturnType<Api['list']>>[number]
type Provider = Awaited<ReturnType<Api['providers']>>[number]
type Login = Awaited<ReturnType<Api['startLogin']>>
type Input = Parameters<Api['save']>[0]

export function ModelConnections({ entering = false, selectedModelId, focusModel, onSelectModel, onChanged }: {
  entering?: boolean
  selectedModelId?: number | null
  onSelectModel?: (id: number) => void
  onChanged?: (connections: Connection[]) => void
  focusModel?: ModelConnectionFocus | null
}) {
  const [connections, setConnections] = useState<Connection[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [archiveDialog, setArchiveDialog] = useState<'export' | 'import' | null>(null)
  const [notice, setNotice] = useState('')
  const changedRef = useRef(onChanged)
  changedRef.current = onChanged

  async function load() {
    setError('')
    setLoading(true)
    try {
      const [items, presets] = await Promise.all([window.fastAgent.modelConnections.list(), window.fastAgent.modelConnections.providers()])
      setConnections(items)
      setProviders(presets)
      setSelected((value) => selectConnectionId(items, value, focusModel))
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
  }

  const current = adding ? null : connections.find((item) => item.id === selected) ?? null
  return <div className={`model-connections ${entering ? 'model-connections-entry' : ''}`}>
    {error && <p role="alert">{error} <button type="button" className="small-control" onClick={() => void load()}>重试</button></p>}
    {loading && !providers.length ? <p role="status"><LoaderCircle size={14} className="spin" />正在加载模型服务…</p> : providers.length > 0 && <>
      {/* 导入要在一台还没有任何连接的新机器上也能用，所以工具条不跟着连接列表一起隐藏 */}
      <div className="model-connection-toolbar">
        <button type="button" className="small-control" disabled={connections.length === 0} onClick={() => { setNotice(''); setArchiveDialog('export') }}><Upload size={13} />导出模型服务</button>
        <button type="button" className="small-control" onClick={() => { setNotice(''); setArchiveDialog('import') }}><Download size={13} />导入模型服务</button>
      </div>
      {connections.length > 0 && <nav className="model-connection-list" aria-label="已配置的模型服务">
        {connections.map((connection) => <button type="button" key={connection.id} aria-current={!adding && connection.id === selected} onClick={() => { setSelected(connection.id); setAdding(false) }}>
          <strong>{connection.name}</strong><small>{providers.find((provider) => provider.id === connection.providerId)?.name ?? connection.providerId} · {connection.models.length} 个模型</small>
        </button>)}
        <button type="button" onClick={() => setAdding(true)}><Plus size={14} />添加模型服务</button>
      </nav>}
      <ConnectionForm key={`${current?.id ?? 'new'}-${revision}-${focusModel?.modelId ?? 'none'}`} initial={current} providers={providers} entering={entering} selectedModelId={selectedModelId} focusModelId={focusModel?.modelId} onSelectModel={onSelectModel} onChanged={changed} />
    </>}
    {notice && <p className="model-connection-notice" role="status">{notice}</p>}
    {archiveDialog === 'export' && <ConnectionExportDialog connections={connections} providers={providers} onClose={() => setArchiveDialog(null)} onNotice={setNotice} />}
    {archiveDialog === 'import' && <ConnectionImportDialog providers={providers} onClose={() => setArchiveDialog(null)} onNotice={setNotice} onImported={() => load()} />}
  </div>
}

/**
 * 连接内模型的参数面板。草稿在本地持有、每次改动即写回连接表单的 models[]，
 * 真正落库仍由外层「保存模型服务」统一提交，与其他字段保持同一个提交时机。
 */
function ConnectionModelParameters({ model, onPatch }: {
  model: DiscoveredConnectionModel
  onPatch: (patch: Partial<DiscoveredConnectionModel>) => void
}) {
  const [draft, setDraft] = useState<ModelParameterDraft>(() => draftFromSource({
    context_window: model.contextWindow ?? null,
    max_tokens: model.maxTokens ?? null,
    temperature: model.temperature,
    timeout: model.timeout,
    max_retries: model.maxRetries,
    model_kind: model.vision === undefined ? undefined : model.vision ? 'multimodal' : 'chat',
    supports_thinking: model.reasoning,
    thinking_default: model.thinkingDefault,
    extra_body: model.extraBody ?? null,
    compat: model.compat ?? null
  }))
  const inferred = inferContextWindow(model.modelId)

  function change(next: ModelParameterDraft) {
    setDraft(next)
    const patch = connectionPatchFromDraft(next)
    // 草稿有错时只留在本地，不把半成品写回连接表单——否则保存会带上上一次的合法值，
    // 用户以为自己改的那次生效了。
    if (patch) onPatch(patch)
  }

  return <ModelParameterFields
    draft={draft}
    placeholders={inferred ? { contextWindow: { value: inferred, origin: '按模型名推断' } } : undefined}
    onChange={change}
  />
}

function ConnectionForm({ initial, providers, entering, selectedModelId, focusModelId, onSelectModel, onChanged }: {
  initial: Connection | null
  providers: Provider[]
  entering: boolean
  selectedModelId?: number | null
  focusModelId?: string
  onSelectModel?: (id: number) => void
  onChanged: (id?: string) => Promise<void>
}) {
  const [mode, setMode] = useState<'oauth' | 'api-key' | null>(initial?.authMode ?? null)
  const [providerId, setProviderId] = useState(initial?.providerId ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [protocol, setProtocol] = useState<LocalModelApi>(initial?.protocol ?? 'openai')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<Input['models']>(initial?.models.map((model) => ({ id: model.id, modelId: model.model_name, name: model.name, contextWindow: model.context_window ?? undefined, maxTokens: model.max_tokens ?? undefined, reasoning: model.supports_thinking, vision: model.model_kind === 'multimodal', thinkingLevelMap: model.thinking_level_map, thinkingDefault: model.thinking_default, thinkingProfiles: model.thinking_profiles })) ?? [])
  const [modelId, setModelId] = useState('')
  const focusedModelId = initial?.models.some((model) => model.model_name === focusModelId) ? focusModelId ?? null : null
  const [expandedModel, setExpandedModel] = useState<string | null>(focusedModelId)
  const [discovered, setDiscovered] = useState<Awaited<ReturnType<Api['models']>>>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(Boolean(focusedModelId))
  const [revealed, setRevealed] = useState(false)
  const [login, setLogin] = useState<Login | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  // 测试结果按模型分别记：结果贴在被点的那一行上，放到弹窗底部要滚很远才看得见，等于没提示。
  const [modelTests, setModelTests] = useState<Record<string, { status: 'running' | 'ok' | 'failed'; text: string }>>({})
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const loginRef = useRef<Login | null>(null)
  const focusedModelRef = useRef<HTMLLIElement | null>(null)
  loginRef.current = login
  const provider = providers.find((item) => item.id === providerId)
  const connectionId = initial?.id ?? (login?.status === 'success' ? login.connectionId : undefined)
  const draft = connectionDraft({ id: connectionId, providerId, name, authMode: mode ?? 'api-key', baseUrl, apiKey, protocol })

  useEffect(() => () => {
    const active = loginRef.current
    if (active && (active.status === 'pending' || active.status === 'input-required')) void window.fastAgent.modelConnections.cancelLogin(active.sessionId).catch(() => {})
  }, [])

  useEffect(() => {
    if (!manageOpen || !focusedModelId) return
    const frame = window.requestAnimationFrame(() => focusedModelRef.current?.scrollIntoView({ block: 'center' }))
    return () => window.cancelAnimationFrame(frame)
  }, [manageOpen, focusedModelId])

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
    setRevealed(false)
    setModels([])
    setDiscovered([])
    setPickerOpen(false)
    setLogin(null)
    setMessage('')
    setError('')
  }

  function addPicked(chosen: DiscoveredConnectionModel[]) {
    const merged = mergeModels(models, chosen)
    setModels(merged)
    setMessage(`已添加 ${merged.length - models.length} 个模型，记得保存模型服务。`)
  }

  /** 已保存的密钥不会随连接列表下发，点开眼睛时才单独取一次。 */
  async function revealKey() {
    if (revealed) { setRevealed(false); return }
    if (apiKey || !initial?.hasCredentials) { setRevealed(true); return }
    await run(async () => {
      setApiKey(await window.fastAgent.modelConnections.revealApiKey(initial.id))
      setRevealed(true)
    })
  }

  /**
   * 单个模型的连通性测试。不走 run()：那会把整个表单置为 busy，其它行的按钮跟着变灰，
   * 而这只是一次针对某一行的探测。结果原地显示，失败信息保留全文供悬停查看。
   */
  async function testModel(modelId: string) {
    setModelTests((current) => ({ ...current, [modelId]: { status: 'running', text: '测试中…' } }))
    try {
      const result = await window.fastAgent.modelConnections.test({ ...draft, modelId })
      setModelTests((current) => ({
        ...current,
        [modelId]: result.ok
          ? { status: 'ok', text: `连接成功 ${result.latencyMs ?? '—'} ms` }
          : { status: 'failed', text: result.error ?? '连接失败' }
      }))
    } catch (cause) {
      setModelTests((current) => ({ ...current, [modelId]: { status: 'failed', text: cause instanceof Error ? cause.message : '连接失败' } }))
    }
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
          <label className="model-connection-field">API Key<span className="plugin-secret-input">
            <input type={revealed ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} value={apiKey} required={!initial?.hasCredentials} onChange={(event) => setApiKey(event.target.value)} placeholder={initial?.hasCredentials ? '留空保留已保存的密钥' : '输入厂商 API Key'} />
            <button type="button" className="icon-button" aria-label={revealed ? '遮挡密钥' : '查看密钥'} title={revealed ? '遮挡密钥' : '查看密钥'} onClick={() => void revealKey()}>{revealed ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </span></label>
        </>}
        {mode === 'oauth' && <>
          {provider.description && <p className="settings-hint">{provider.description}</p>}
          <div className="model-connection-actions">
            <button type="button" className="quick-secondary" onClick={() => void run(async () => { setLogin(await window.fastAgent.modelConnections.startLogin(providerId, initial?.id)) })}>{initial?.hasCredentials || login?.status === 'success' ? '重新登录账号' : '在浏览器中登录'}</button>
            {initial?.hasCredentials && <button type="button" className="small-control" onClick={() => void run(async () => { await window.fastAgent.modelConnections.logout(initial.id); await onChanged(initial.id) })}>退出此账号</button>}
          </div>
        </>}
      </fieldset>
      {login && <div className="model-login-status" role="status">
        <p>{login.status === 'success' ? login.message ?? '账号授权成功，可以选择模型。' : login.error ?? login.message ?? (login.status === 'pending' ? '已在系统浏览器打开授权页，请完成授权…' : login.status === 'cancelled' ? '已取消授权' : login.status === 'expired' ? '授权已过期，请重新登录' : '等待账号授权')}</p>
        {login.url && <p className="model-login-url">未自动打开可手动访问：{login.url}</p>}
        {login.userCode && <p>设备验证码：<strong>{login.userCode}</strong> <button type="button" className="small-control" onClick={() => void navigator.clipboard?.writeText(login.userCode!)}>复制</button></p>}
        {login.status === 'input-required' && login.prompt?.options && <div className="model-connection-actions">{login.prompt.options.map((option) => <button type="button" className="small-control" disabled={busy} key={option.id} onClick={() => void run(async () => { await window.fastAgent.modelConnections.answerLogin(login.sessionId, option.id); setLogin(await window.fastAgent.modelConnections.authState(login.sessionId)) })}>{option.label}</button>)}</div>}
        {login.status === 'input-required' && <label className="model-connection-field">{login.prompt?.message ?? '输入验证码'}<input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={login.prompt?.placeholder} /><button type="button" className="small-control" disabled={busy || (!answer.trim() && !login.prompt?.allowEmpty)} onClick={() => void run(async () => { await window.fastAgent.modelConnections.answerLogin(login.sessionId, answer); setAnswer(''); setLogin(await window.fastAgent.modelConnections.authState(login.sessionId)) })}>提交验证码</button></label>}
        {authorizing && <button type="button" className="small-control" onClick={() => void run(async () => { await window.fastAgent.modelConnections.cancelLogin(login.sessionId); setLogin({ ...login, status: 'cancelled' }) })}>取消授权</button>}
      </div>}
      <fieldset disabled={busy || authorizing}>
        <div className="model-connection-model-heading"><h4>连接内模型</h4><div className="model-connection-actions">
          <button type="button" className="small-control" disabled={!models.length} onClick={() => setManageOpen(true)}>管理已添加（{models.length}）</button>
          {discovered.length > 0 && <button type="button" className="small-control" onClick={() => setPickerOpen(true)}>选择模型（{discovered.length}）</button>}
          <button type="button" className="small-control" onClick={() => void run(async () => {
            const items = await window.fastAgent.modelConnections.models(draft)
            setDiscovered(items)
            setPickerOpen(items.length > 0)
            if (!items.length) setMessage('没有获取到模型，请手动输入模型 ID。')
          })}>获取模型</button>
        </div></div>
        <div className="model-connection-add"><label className="model-connection-field">模型 ID<input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="手动输入模型 ID" spellCheck={false} /></label><button type="button" className="small-control" disabled={!modelId.trim()} onClick={() => { setModels(addModel(models, modelId)); setModelId('') }}>添加</button></div>
        <p className="settings-hint">{models.length ? `已添加 ${models.length} 个模型，点「管理已添加」调整多模态、参数与当前模型。` : '还没有添加模型：先「获取模型」批量勾选，或手动输入模型 ID。'}</p>
        <div className="model-connection-actions"><button className="primary-button" type="submit" disabled={!models.length || (mode === 'oauth' && !initial?.hasCredentials && login?.status !== 'success')}>{entering ? '测试并进入工作区' : '保存模型服务'}</button>{initial && <button type="button" className="small-control danger" onClick={() => setConfirmDelete(true)}>删除连接</button>}</div>
      </fieldset>
    </form>}
    {confirmDelete && initial && <div className="model-connection-delete" role="alert"><p>删除“{initial.name}”及其中 {initial.models.length} 个模型？历史会话会保留。</p><button type="button" className="small-control danger" disabled={busy} onClick={() => void run(async () => { await window.fastAgent.modelConnections.remove(initial.id); await onChanged() })}>确认删除连接和 {initial.models.length} 个模型</button><button type="button" className="small-control" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button></div>}
    {busy && <p role="status"><LoaderCircle size={14} className="spin" />正在处理…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    {manageOpen && <CenterDialog
      title="连接内模型"
      subtitle={`${models.length} 个模型 · 改动要回到表单点保存才落库`}
      icon={<SlidersHorizontal size={16} />}
      busy={busy}
      onClose={() => setManageOpen(false)}
      footer={<button type="button" className="approval-primary" onClick={() => setManageOpen(false)}>完成</button>}
    >
      <ul className="model-connection-models">{models.map((model) => <li key={model.modelId} ref={model.modelId === focusedModelId ? focusedModelRef : undefined} className={model.modelId === focusedModelId ? 'model-connection-model-focused' : undefined}><span><strong>{model.name ?? model.modelId}</strong><small>{model.modelId}</small></span><div className="model-connection-actions">
        {/* 未勾选时运行时按纯文本申明能力，附件里的图片会被 pi 换成「image omitted」占位文本 */}
        <label className="model-connection-vision" title="模型支持图片输入；关闭后附件中的图片不会发送给模型"><input type="checkbox" checked={model.vision ?? false} disabled={busy} onChange={(event) => setModels(models.map((item) => item.modelId === model.modelId ? { ...item, vision: event.target.checked } : item))} />多模态</label>
        <button type="button" className="small-control" aria-expanded={expandedModel === model.modelId} onClick={() => setExpandedModel(expandedModel === model.modelId ? null : model.modelId)}><SlidersHorizontal size={13} />参数</button>
        <button type="button" className="small-control" disabled={busy || modelTests[model.modelId]?.status === 'running'} onClick={() => void testModel(model.modelId)}>测试</button>
        {modelTests[model.modelId] && <span className={`model-connection-test-result ${modelTests[model.modelId].status}`} title={modelTests[model.modelId].text}>{modelTests[model.modelId].text}</span>}
        {model.id !== undefined && <button type="button" className="small-control" disabled={busy || model.id === selectedModelId} onClick={() => void run(async () => { if (entering) await window.fastAgent.auth.enterWorkspace(model.id); else onSelectModel?.(model.id!) })}>{entering ? '进入工作区' : model.id === selectedModelId ? '使用中' : '设为当前模型'}</button>}
        <button type="button" className="small-control" disabled={busy} aria-label={`移除模型 ${model.modelId}`} onClick={() => setModels(models.filter((item) => item.modelId !== model.modelId))}><Trash2 size={13} /></button>
      </div>
      {expandedModel === model.modelId && <ConnectionModelParameters model={model} onPatch={(patch) => setModels(models.map((item) => item.modelId === model.modelId ? { ...item, ...patch } : item))} />}
      </li>)}</ul>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </CenterDialog>}
    {pickerOpen && <DiscoveredModelsDialog discovered={discovered} existing={models.map((model) => model.modelId)} onClose={() => setPickerOpen(false)} onAdd={addPicked} />}
  </div>
}
