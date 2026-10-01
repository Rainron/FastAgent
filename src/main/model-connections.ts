import { randomUUID } from 'node:crypto'
import { CredentialSynchronizationError, ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { Api, CredentialStore, Model } from '@earendil-works/pi-ai'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import type { DiscoveredConnectionModel, ModelConnectionDraft, ModelConnectionInput, ModelConnectionsApi, ModelLoginState } from '../shared/types'
import { MODEL_PROVIDERS, modelProvider } from '../shared/model-providers'
import type { ModelConnectionStore } from './local-store/model-connections'
import { modelLoginError } from './model-login-error'

type LoginSession = { providerId: string; state: ModelLoginState; abort: AbortController; timer: ReturnType<typeof setTimeout>; ephemeral: boolean; openedUrl?: string; answer?: (value: string) => void; reject?: (error: Error) => void }

// 厂商有效期允许覆盖 10 分钟默认截止时间，但封顶 15 分钟，并留出余量让 pi 的设备码过期错误先生效。
const LOGIN_DEFAULT_TIMEOUT_MS = 10 * 60_000
const LOGIN_VENDOR_MAX_TIMEOUT_MS = 15 * 60_000
const LOGIN_VENDOR_GRACE_MS = 30_000
type Dependencies = { fetch?: typeof fetch; createRuntime?: (credentials: CredentialStore) => Promise<ModelRuntime>; openExternal?: (url: string) => unknown; onChanged?: () => void }
type RuntimeModelCapabilities = Model<Api> & { thinkingDefault?: string; thinkingProfiles?: Record<string, unknown> | null }

export class ModelConnectionService implements ModelConnectionsApi {
  private readonly sessions = new Map<string, LoginSession>()
  private readonly runtimes = new Map<string, Promise<ModelRuntime>>()
  private catalogRuntime?: Promise<ModelRuntime>
  private readonly fetch: typeof fetch
  private readonly buildRuntime: (credentials: CredentialStore) => Promise<ModelRuntime>
  private readonly openExternal: (url: string) => unknown
  private readonly onChanged: () => void

  constructor(private readonly store: ModelConnectionStore, dependencies: Dependencies = {}) {
    this.fetch = dependencies.fetch ?? globalThis.fetch
    this.openExternal = dependencies.openExternal ?? (() => {})
    this.onChanged = dependencies.onChanged ?? (() => {})
    this.buildRuntime = dependencies.createRuntime ?? ((credentials) => ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false }))
  }

  async providers() { return structuredClone(MODEL_PROVIDERS) }
  async list() { return this.healVisionFlags(this.store.list()) }
  async save(input: ModelConnectionInput) { const result = this.store.save({ ...input, models: await this.enrichModels(input, input.models) }); this.runtimes.delete(result.id); this.onChanged(); return result }
  async remove(id: string) {
    for (const session of this.sessions.values()) if (session.state.connectionId === id) await this.cancelLogin(session.state.sessionId)
    this.runtimes.delete(id)
    this.store.remove(id)
    this.onChanged()
  }

  private runtime(id: string): Promise<ModelRuntime> {
    let runtime = this.runtimes.get(id)
    if (!runtime) {
      runtime = this.buildRuntime(this.store.credentials(id))
      this.runtimes.set(id, runtime)
      void runtime.catch(() => { if (this.runtimes.get(id) === runtime) this.runtimes.delete(id) })
    }
    return runtime
  }

  async createRuntime(id: string, modelName: string): Promise<{ runtime: ModelRuntime; model: Model<Api> }> {
    const metadata = this.store.metadata(id)
    const provider = modelProvider(metadata.providerId)
    if (metadata.authMode !== 'oauth' || !provider.oauthProviderId) throw new Error('该连接不是账号连接')
    const runtime = await this.runtime(id)
    const model = runtime.getModel(provider.oauthProviderId, modelName)
    if (!model) throw new Error('账号提供商不支持此模型，请重新获取模型列表')
    try {
      if (!await runtime.getAuth(model)) throw new Error('missing')
    } catch { throw new Error('账号授权不可用或刷新失败，请重新登录模型厂商') }
    return { runtime, model }
  }

  async models(input: ModelConnectionDraft): Promise<DiscoveredConnectionModel[]> {
    if (input.authMode === 'oauth') {
      if (!input.id) throw new Error('请先登录模型厂商账号')
      const metadata = this.store.metadata(input.id)
      const providerId = modelProvider(metadata.providerId).oauthProviderId
      if (!providerId) throw new Error('该厂商不支持账号登录')
      const runtime = await this.runtime(input.id)
      return runtime.getModels(providerId).map((model) => {
        const capabilities = model as RuntimeModelCapabilities
        return { modelId: model.id, name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens, reasoning: model.reasoning, vision: model.input?.includes('image') ?? false, thinkingLevelMap: model.thinkingLevelMap, thinkingDefault: capabilities.thinkingDefault, thinkingProfiles: capabilities.thinkingProfiles }
      })
    }
    const { metadata, secrets } = this.store.resolve(input)
    const headers = this.headers(metadata.protocol, secrets)
    const url = metadata.protocol === 'anthropic' ? `${metadata.baseUrl.replace(/\/v1$/, '')}/v1/models` : `${metadata.baseUrl}/models`
    try {
      const response = await this.fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20_000) })
      if (!response.ok) throw new Error('request failed')
      const body = await response.json() as { data?: { id?: unknown; display_name?: string; name?: string }[] }
      if (!Array.isArray(body.data)) throw new Error('invalid response')
      return this.enrichModels(input, body.data.filter((item) => typeof item.id === 'string').map((item) => ({ modelId: item.id as string, name: item.display_name ?? item.name ?? item.id as string })))
    } catch { throw new Error('模型列表获取失败，可手动填写模型标识') }
  }

  /** 把厂商 id 映射到 pi 静态目录里的 provider；账号连接直接用登录用的 provider。 */
  private catalogProviders(providerId: string, authMode: 'api-key' | 'oauth'): string[] {
    const preset = modelProvider(providerId)
    if (authMode === 'oauth') return preset.oauthProviderId ? [preset.oauthProviderId] : []
    const overrides: Record<string, string[]> = { zhipu: ['zai', 'zai-coding-cn'], kimi: ['moonshotai', 'moonshotai-cn'], gemini: ['google'], qwen: ['qwen-token-plan', 'qwen-token-plan-cn'], minimax: ['minimax', 'minimax-cn'] }
    return overrides[providerId] ?? [providerId]
  }

  private async catalogModels(providers: string[]): Promise<RuntimeModelCapabilities[]> {
    if (!providers.length) return []
    // 只查随 pi 安装的静态目录，避免获取能力时读取个人凭据或发起外部请求。
    this.catalogRuntime ??= this.buildRuntime(new InMemoryCredentialStore())
    const runtime = await this.catalogRuntime
    return runtime.getModels().filter((model) => providers.includes(model.provider)) as RuntimeModelCapabilities[]
  }

  /**
   * 这次改动之前所有连接内模型都被硬编码成 model_kind='chat'，图片会被运行时换成占位文本。
   * 读取连接列表时按 pi 静态目录补齐一次，用户不必重新「获取模型」再保存。
   * 只升不降：目录不认识的模型保留用户手动勾选的结果。
   */
  private async healVisionFlags<T extends Awaited<ReturnType<ModelConnectionStore['list']>>>(connections: T): Promise<T> {
    try {
      for (const connection of connections) {
        const catalog = await this.catalogModels(this.catalogProviders(connection.providerId, connection.authMode))
        if (!catalog.length) continue
        for (const model of connection.models) {
          if (model.model_kind === 'multimodal') continue
          const known = catalog.find((entry) => entry.id === model.model_name)
          if (!known?.input.includes('image')) continue
          model.model_kind = 'multimodal'
          this.store.setModelKind(-model.id, 'multimodal')
        }
      }
    } catch { /* 目录不可用时保持原样，能力标记退回用户手动勾选 */ }
    return connections
  }

  private async enrichModels(input: ModelConnectionDraft, models: DiscoveredConnectionModel[]): Promise<DiscoveredConnectionModel[]> {
    if (input.authMode !== 'api-key' || !models.length || input.providerId === 'custom') return models
    const catalog = await this.catalogModels(this.catalogProviders(input.providerId, 'api-key'))
    return models.map((model) => {
      const known = catalog.find((entry) => entry.id === model.modelId.trim())
      return known ? { ...model, contextWindow: model.contextWindow ?? known.contextWindow, maxTokens: model.maxTokens ?? known.maxTokens, reasoning: known.reasoning, vision: known.input?.includes('image') ?? false, thinkingLevelMap: known.thinkingLevelMap, thinkingDefault: known.thinkingDefault, thinkingProfiles: known.thinkingProfiles } : model
    })
  }

  private headers(protocol: string, secrets: { api_key?: string; headers?: Record<string, string> }): Record<string, string> {
    return protocol === 'anthropic'
      ? { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': secrets.api_key ?? '', ...secrets.headers }
      : { 'content-type': 'application/json', ...(secrets.api_key ? { authorization: `Bearer ${secrets.api_key}` } : {}), ...secrets.headers }
  }

  async test(input: ModelConnectionDraft & { modelId: string }) {
    const started = Date.now()
    try {
      if (input.authMode === 'oauth') {
        if (!input.id) throw new Error('missing')
        const { runtime, model } = await this.createRuntime(input.id, input.modelId)
        const result = await runtime.completeSimple(model, { messages: [{ role: 'user', content: 'Reply OK.', timestamp: Date.now() }] }, { maxTokens: 64, signal: AbortSignal.timeout(30_000) })
        if (result.stopReason === 'error' || result.stopReason === 'aborted') throw new Error('request failed')
      } else {
        const { metadata, secrets } = this.store.resolve(input)
        const anthropic = metadata.protocol === 'anthropic'
        const responses = metadata.protocol === 'openai-responses'
        const url = anthropic ? `${metadata.baseUrl.replace(/\/v1$/, '')}/v1/messages` : `${metadata.baseUrl}/${responses ? 'responses' : 'chat/completions'}`
        const body = responses ? { model: input.modelId, input: 'Reply OK.', max_output_tokens: 64 } : { model: input.modelId, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 64 }
        const response = await this.fetch(url, { method: 'POST', headers: this.headers(metadata.protocol, secrets), body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30_000) })
        if (!response.ok) return { ok: false, error: `连接测试失败（HTTP ${response.status}），请检查模型、凭据和服务地址`, latencyMs: Date.now() - started }
      }
      return { ok: true, latencyMs: Date.now() - started }
    } catch { return { ok: false, error: '连接测试失败，请检查模型、凭据和服务地址；账号连接可尝试重新登录', latencyMs: Date.now() - started } }
  }

  async startLogin(providerId: string, connectionId?: string): Promise<ModelLoginState> {
    const provider = modelProvider(providerId)
    if (!provider.oauthProviderId) throw new Error('该厂商未提供可用的账号登录，请使用 API Key')
    // OpenAI 等厂商绑定固定本地回调端口，同厂商并发登录会互相抢占回调。
    for (const active of this.sessions.values()) {
      if (active.providerId === providerId && ['pending', 'input-required'].includes(active.state.status)) throw new Error('该厂商已有进行中的账号登录，请先完成或取消后再试')
    }
    if (connectionId) {
      const metadata = this.store.metadata(connectionId)
      if (metadata.providerId !== providerId || metadata.authMode !== 'oauth') throw new Error('账号连接不匹配')
      for (const active of this.sessions.values()) if (active.state.connectionId === connectionId) await this.cancelLogin(active.state.sessionId)
    }
    const ephemeral = !connectionId
    const id = connectionId ?? this.store.save({ providerId, authMode: 'oauth', models: [] }).id
    const sessionId = randomUUID()
    const session: LoginSession = {
      providerId, state: { sessionId, connectionId: id, status: 'pending' }, abort: new AbortController(), ephemeral,
      timer: setTimeout(() => this.finishLogin(sessionId, 'expired'), LOGIN_DEFAULT_TIMEOUT_MS)
    }
    session.timer.unref?.()
    this.sessions.set(sessionId, session)
    // 登录返回后仍须检查取消状态，避免回调竞争把过期账号写回。
    const base = this.store.credentials(id)
    const guarded: CredentialStore = { ...base, modify: (key, fn, options) => base.modify(key, async (old) => {
      if (session.abort.signal.aborted) throw new Error('登录已取消')
      const next = await fn(old)
      if (session.abort.signal.aborted) throw new Error('登录已取消')
      return next
    }, options) }
    let successMessage = '账号授权成功，可以选择模型。'
    void this.buildRuntime(guarded).then(async (runtime) => {
      if (session.abort.signal.aborted) return
      await runtime.login(provider.oauthProviderId!, 'oauth', {
        signal: session.abort.signal,
        notify: (event) => {
          if (session.abort.signal.aborted) return
          if (event.type === 'auth_url') { Object.assign(session.state, { url: event.url, message: event.instructions }); this.openAuthUrl(session, event.url) }
          else if (event.type === 'device_code') {
            Object.assign(session.state, { url: event.verificationUri, userCode: event.userCode })
            this.openAuthUrl(session, event.verificationUri)
            const expires = event.expiresInSeconds
            if (typeof expires === 'number' && Number.isFinite(expires) && expires > 0) {
              // 重新武装计时器前先释放旧的，避免旧计时器提前结束新有效期。
              clearTimeout(session.timer)
              const deadline = Math.min(expires * 1000, LOGIN_VENDOR_MAX_TIMEOUT_MS) + LOGIN_VENDOR_GRACE_MS
              session.timer = setTimeout(() => this.finishLogin(sessionId, 'expired'), Math.max(deadline, 30_000))
              session.timer.unref?.()
            }
          }
          else session.state.message = event.message
        },
        prompt: (prompt) => new Promise<string>((resolve, reject) => {
          if (session.abort.signal.aborted) { reject(new Error('登录已取消')); return }
          session.state.status = 'input-required'
          session.state.prompt = { message: prompt.message, ...('placeholder' in prompt ? { placeholder: prompt.placeholder } : {}), ...(prompt.type === 'select' ? { options: [...prompt.options] } : {}) }
          const cleanup = () => { session.answer = undefined; session.reject = undefined; prompt.signal?.removeEventListener('abort', aborted); session.abort.signal.removeEventListener('abort', aborted); delete session.state.prompt; if (session.state.status === 'input-required') session.state.status = 'pending' }
          const aborted = () => { cleanup(); reject(new Error('登录已取消')) }
          session.answer = (value) => { cleanup(); resolve(value) }
          session.reject = (error) => { cleanup(); reject(error) }
          prompt.signal?.addEventListener('abort', aborted, { once: true })
          session.abort.signal.addEventListener('abort', aborted, { once: true })
          if (prompt.signal?.aborted) aborted()
        })
      }).catch((error: unknown) => {
        // pi 将凭据提交与模型快照同步分开；仅后者失败时凭据已有效落库，后续会重建运行时。
        if (!(error instanceof CredentialSynchronizationError) || error.operation !== 'login' || error.providerId !== provider.oauthProviderId || error.credential?.type !== 'oauth') throw error
        successMessage = '账号授权已保存，但模型状态同步失败；可重新获取模型并测试连接。'
      })
      if (!session.abort.signal.aborted) { session.state.status = 'success'; session.state.message = successMessage; clearTimeout(session.timer); this.runtimes.delete(id); this.onChanged() }
    }).catch((error: unknown) => {
      if (!session.abort.signal.aborted) {
        session.state.status = 'error'
        session.state.error = modelLoginError(error)
        clearTimeout(session.timer)
        this.cleanupEphemeral(session)
      }
    })
    return structuredClone(session.state)
  }

  // 授权链接直接送进系统浏览器；同一链接只开一次，界面上的地址只作为打开失败时的兜底。
  private openAuthUrl(session: LoginSession, url: string | undefined): void {
    if (!url || session.openedUrl === url) return
    session.openedUrl = url
    try {
      void Promise.resolve(this.openExternal(url)).catch(() => { /* 打不开浏览器不影响手动复制地址 */ })
    } catch { /* 同上 */ }
  }

  async authState(sessionId: string): Promise<ModelLoginState> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('登录会话不存在或已过期')
    return structuredClone(session.state)
  }

  async answerLogin(sessionId: string, value: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session?.answer || session.state.status !== 'input-required') throw new Error('当前登录步骤不需要输入')
    session.answer(value)
  }

  private finishLogin(sessionId: string, status: 'cancelled' | 'expired'): void {
    const session = this.sessions.get(sessionId)
    if (!session || !['pending', 'input-required'].includes(session.state.status)) return
    session.state.status = status
    clearTimeout(session.timer)
    session.abort.abort()
    session.reject?.(new Error('登录已取消'))
    delete session.state.prompt
    this.cleanupEphemeral(session)
  }

  private cleanupEphemeral(session: LoginSession): void {
    if (!session.ephemeral) return
    try {
      const connection = this.store.list().find((item) => item.id === session.state.connectionId)
      if (connection && !connection.hasCredentials && connection.models.length === 0) this.store.remove(connection.id)
    } catch { /* 清理失败不应覆盖登录状态 */ }
  }

  async cancelLogin(sessionId: string): Promise<void> { this.finishLogin(sessionId, 'cancelled') }
  async logout(id: string): Promise<void> {
    for (const session of this.sessions.values()) if (session.state.connectionId === id) await this.cancelLogin(session.state.sessionId)
    const metadata = this.store.metadata(id)
    const providerId = modelProvider(metadata.providerId).oauthProviderId
    if (metadata.authMode !== 'oauth' || !providerId) throw new Error('该连接不是账号连接')
    await this.store.credentials(id).delete(providerId)
    this.runtimes.delete(id)
    this.onChanged()
  }

  dispose(): void {
    for (const id of this.sessions.keys()) this.finishLogin(id, 'cancelled')
    this.sessions.clear()
    this.runtimes.clear()
  }
}
