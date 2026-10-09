import { randomUUID } from 'node:crypto'
import { CredentialSynchronizationError, ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { Api, CredentialStore, Model } from '@earendil-works/pi-ai'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import type { DiscoveredConnectionModel, ModelConnectionArchiveSecret, ModelConnectionDraft, ModelConnectionInput, ModelConnectionsCoreApi, ModelConnectionsExportOptions, ModelConnectionsImportPlan, ModelLoginState } from '../shared/types'
import { MODEL_PROVIDERS, modelProvider } from '../shared/model-providers'
import type { ModelConnectionStore } from './local-store/model-connections'
import { modelLoginError, modelLoginErrorDetail } from './model-login-error'
import { modelBaseUrl, modelProtocolAdapter } from '../shared/model-protocols'
import { archiveSecretAt, buildConnectionsArchive, connectionsArchiveNeedsPassphrase, readConnectionsArchive } from './model-connections-archive'
import { uniqueConnectionName } from './model-connections-names'

type LoginSession = { providerId: string; state: ModelLoginState; abort: AbortController; timer: ReturnType<typeof setTimeout>; ephemeral: boolean; openedUrl?: string; answer?: (value: string) => void; reject?: (error: Error) => void }

// 厂商有效期允许覆盖 10 分钟默认截止时间，但封顶 15 分钟，并留出余量让 pi 的设备码过期错误先生效。
const LOGIN_DEFAULT_TIMEOUT_MS = 10 * 60_000
const LOGIN_VENDOR_MAX_TIMEOUT_MS = 15 * 60_000
const LOGIN_VENDOR_GRACE_MS = 30_000
type Dependencies = { fetch?: typeof fetch; createRuntime?: (credentials: CredentialStore) => Promise<ModelRuntime>; openExternal?: (url: string) => unknown; onChanged?: () => void; appVersion?: string; /** 登录失败的上游原文出口：界面只拿分类文案，排查要靠日志 */ onLoginFailed?: (input: { providerId: string; message: string; status?: number }) => void }
type RuntimeModelCapabilities = Model<Api> & { thinkingDefault?: string; thinkingProfiles?: Record<string, unknown> | null }
/** pi 静态目录里一个模型的规格，只取自动压缩与输出预算要用的两项。 */
type ModelSpec = { contextWindow?: number; maxTokens?: number }

export class ModelConnectionService implements ModelConnectionsCoreApi {
  private readonly sessions = new Map<string, LoginSession>()
  private readonly runtimes = new Map<string, Promise<ModelRuntime>>()
  private catalogRuntime?: Promise<ModelRuntime>
  private catalogSpecIndex?: Promise<{ byId: Map<string, ModelSpec>; bySuffix: Map<string, ModelSpec> }>
  private readonly fetch: typeof fetch
  private readonly buildRuntime: (credentials: CredentialStore) => Promise<ModelRuntime>
  private readonly openExternal: (url: string) => unknown
  private readonly onChanged: () => void
  private readonly appVersion?: string
  private readonly onLoginFailed: (input: { providerId: string; message: string; status?: number }) => void

  constructor(private readonly store: ModelConnectionStore, dependencies: Dependencies = {}) {
    this.fetch = dependencies.fetch ?? globalThis.fetch
    this.openExternal = dependencies.openExternal ?? (() => {})
    this.onChanged = dependencies.onChanged ?? (() => {})
    this.appVersion = dependencies.appVersion
    this.onLoginFailed = dependencies.onLoginFailed ?? (() => {})
    this.buildRuntime = dependencies.createRuntime ?? ((credentials) => ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false }))
  }

  async providers() { return structuredClone(MODEL_PROVIDERS) }
  async list() { return this.healModelMetadata(this.store.list()) }
  async save(input: ModelConnectionInput) { const result = this.store.save({ ...input, models: await this.enrichModels(input, input.models) }); this.runtimes.delete(result.id); this.onChanged(); return result }
  async remove(id: string) {
    for (const session of this.sessions.values()) if (session.state.connectionId === id) await this.cancelLogin(session.state.sessionId)
    this.runtimes.delete(id)
    this.store.remove(id)
    this.onChanged()
  }

  /**
   * 导出勾选的连接。密钥只有在 secrets 不是 omit 时才从 store 解出来，
   * 账号连接无论哪一档都不带凭据——刷新令牌泄露的代价高于重新登录一次。
   */
  exportConnections(options: ModelConnectionsExportOptions): string {
    const selected = this.store.list().filter((connection) => options.ids.includes(connection.id))
    if (!selected.length) throw new Error('请至少勾选一个模型服务')
    const secretsByIndex: Record<string, ModelConnectionArchiveSecret> = {}
    const connections = selected.map((connection, index) => {
      if (options.secrets !== 'omit' && connection.authMode === 'api-key') {
        const secret = this.store.apiKeySecrets(connection.id)
        if (secret.apiKey || secret.headers) secretsByIndex[String(index)] = secret
      }
      const picked = options.modelIds?.[connection.id]
      return {
        providerId: connection.providerId,
        name: connection.name,
        authMode: connection.authMode,
        baseUrl: connection.baseUrl,
        protocol: connection.protocol,
        models: this.store.connectionModels(connection.id).filter((model) => !picked || picked.includes(model.modelId)),
        hasSecrets: false
      }
    })
    return buildConnectionsArchive({ connections, secretsByIndex, secrets: options.secrets, passphrase: options.passphrase, appVersion: this.appVersion })
  }

  previewArchive(text: string, passphrase?: string) { return readConnectionsArchive(text, passphrase) }
  archiveNeedsPassphrase(text: string) { return connectionsArchiveNeedsPassphrase(text) }

  /** 按勾选落地。同名连接另存为副本，本地已有连接不受影响。 */
  importConnections(text: string, plan: ModelConnectionsImportPlan): number {
    const archive = readConnectionsArchive(text, plan.passphrase)
    const taken = new Set(this.store.list().map((connection) => connection.name))
    let saved = 0
    for (const index of plan.indexes) {
      const entry = archive.connections[index]
      if (!entry) continue
      const secret = archiveSecretAt(archive, index)
      const name = uniqueConnectionName(entry.name, taken)
      const picked = plan.modelIds?.[String(index)]
      taken.add(name)
      this.store.save({
        providerId: entry.providerId,
        name,
        authMode: entry.authMode,
        baseUrl: entry.baseUrl,
        protocol: entry.protocol,
        ...(secret.apiKey ? { apiKey: secret.apiKey } : {}),
        ...(secret.headers ? { headers: secret.headers } : {}),
        models: entry.models.filter((model) => !picked || picked.includes(model.modelId))
      })
      saved += 1
    }
    if (saved) this.onChanged()
    return saved
  }

  /** 供界面回显已保存的 API Key；账号连接没有可回显的密钥。 */
  revealApiKey(id: string): string {
    if (this.store.metadata(id).authMode !== 'api-key') throw new Error('账号连接没有可查看的 API Key')
    return this.store.apiKeySecrets(id).apiKey ?? ''
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
    const adapter = modelProtocolAdapter(metadata.protocol)
    const url = adapter.modelsUrl(modelBaseUrl(metadata.protocol, metadata.providerId, metadata.baseUrl))
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
   * 按模型标识跨全部厂商目录建索引，只取窗口与单次输出上限。
   *
   * 自建网关（providerId='custom'）不对应任何 pi 目录厂商，走不到 catalogModels，
   * 网关的 /v1/models 又基本不返回 context_window——窗口于是一路掉到按模型名推断，
   * 像 deepseek→64K、glm→128K 这种规则对 100 万窗口的网关模型偏小十几倍，
   * 自动压缩会在真实用量百分之几的时候就触发。
   *
   * 同名模型在不同厂商目录里窗口不一致时取最大值：估大了撞上下文溢出有 Pi 的溢出压缩兜底，
   * 估小了则是每轮都白压一次，后者更难被发现。任何显式配置仍然优先于这里的值。
   */
  private async catalogSpecs(): Promise<{ byId: Map<string, ModelSpec>; bySuffix: Map<string, ModelSpec> }> {
    this.catalogSpecIndex ??= (async () => {
      const byId = new Map<string, ModelSpec>()
      const bySuffix = new Map<string, ModelSpec>()
      const merge = (target: Map<string, ModelSpec>, key: string, model: Model<Api>) => {
        const previous = target.get(key)
        target.set(key, {
          contextWindow: Math.max(previous?.contextWindow ?? 0, model.contextWindow > 0 ? model.contextWindow : 0) || undefined,
          maxTokens: Math.max(previous?.maxTokens ?? 0, model.maxTokens > 0 ? model.maxTokens : 0) || undefined
        })
      }
      try {
        this.catalogRuntime ??= this.buildRuntime(new InMemoryCredentialStore())
        const runtime = await this.catalogRuntime
        for (const model of runtime.getModels()) {
          const id = model.id.toLowerCase()
          merge(byId, id, model)
          // 网关常给模型加厂商前缀（deepseek/…、zai-org/…），按尾段再存一份作为回退匹配。
          const suffix = id.slice(id.lastIndexOf('/') + 1)
          if (suffix !== id) merge(bySuffix, suffix, model)
        }
      } catch {
        // 目录不可用时退回原有行为（按模型名推断），不能让取不到目录把保存连接也一起拖失败。
      }
      return { byId, bySuffix }
    })()
    return this.catalogSpecIndex
  }

  /**
   * 精确标识优先，其次忽略厂商前缀匹配——前缀可能出现在任何一边：
   * 网关给 `zai-org/GLM-5.3` 而目录收录的是 `glm-5.3`，反过来也有。
   */
  private async catalogSpec(modelId: string): Promise<ModelSpec | undefined> {
    const id = modelId.trim().toLowerCase()
    if (!id) return undefined
    const { byId, bySuffix } = await this.catalogSpecs()
    const exact = byId.get(id)
    if (exact) return exact
    const suffix = id.slice(id.lastIndexOf('/') + 1)
    return byId.get(suffix) ?? bySuffix.get(suffix)
  }

  /**
   * 读取连接列表时按 pi 静态目录补齐两类元数据，用户不必重新「获取模型」再保存。
   *
   * - 能力标记：这次改动之前所有连接内模型都被硬编码成 model_kind='chat'，图片会被运行时换成占位文本。
   *   只升不降，目录不认识的模型保留用户手动勾选的结果。
   * - 上下文窗口：存量模型大多没有 context_window（网关的 /v1/models 不给），
   *   运行时只能按模型名推断，压缩阈值因此算在一个偏小十几倍的分母上。
   *   只在缺值时补，用户显式填过的值永远优先，补完写回 payload 且在设置页可改。
   */
  private async healModelMetadata<T extends Awaited<ReturnType<ModelConnectionStore['list']>>>(connections: T): Promise<T> {
    try {
      for (const connection of connections) {
        const catalog = await this.catalogModels(this.catalogProviders(connection.providerId, connection.authMode))
        for (const model of connection.models) {
          const known = catalog.find((entry) => entry.id === model.model_name)
          if (!(Number(model.context_window) > 0)) {
            const window = known?.contextWindow && known.contextWindow > 0 ? known.contextWindow : (await this.catalogSpec(model.model_name))?.contextWindow
            if (window && window > 0) {
              model.context_window = window
              this.store.setModelContextWindow(-model.id, window)
            }
          }
          if (model.model_kind === 'multimodal') continue
          if (!known?.input.includes('image')) continue
          model.model_kind = 'multimodal'
          this.store.setModelKind(-model.id, 'multimodal')
        }
      }
    } catch { /* 目录不可用时保持原样：能力标记退回用户手动勾选，窗口退回按模型名推断 */ }
    return connections
  }

  private async enrichModels(input: ModelConnectionDraft, models: DiscoveredConnectionModel[]): Promise<DiscoveredConnectionModel[]> {
    if (input.authMode !== 'api-key' || !models.length) return models
    // 自建网关没有对应的目录厂商，能力标记只能靠用户勾选；窗口仍然按模型标识全局找一次。
    const catalog = input.providerId === 'custom' ? [] : await this.catalogModels(this.catalogProviders(input.providerId, 'api-key'))
    const specs = await Promise.all(models.map((model) => this.catalogSpec(model.modelId)))
    return models.map((model, index) => {
      const known = catalog.find((entry) => entry.id === model.modelId.trim())
      const spec = specs[index]
      // 优先级：用户/网关给的值 > 本厂商目录 > 全目录同名匹配。能力标记只认本厂商目录。
      const sized = { ...model, contextWindow: model.contextWindow ?? known?.contextWindow ?? spec?.contextWindow, maxTokens: model.maxTokens ?? known?.maxTokens ?? spec?.maxTokens }
      return known ? { ...sized, reasoning: known.reasoning, vision: known.input?.includes('image') ?? false, thinkingLevelMap: known.thinkingLevelMap, thinkingDefault: known.thinkingDefault, thinkingProfiles: known.thinkingProfiles } : sized
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
        const adapter = modelProtocolAdapter(metadata.protocol)
        const responses = metadata.protocol === 'openai-responses'
        const url = adapter.chatUrl(modelBaseUrl(metadata.protocol, metadata.providerId, metadata.baseUrl))
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
        try { this.onLoginFailed({ providerId, ...modelLoginErrorDetail(error) }) } catch { /* 记日志失败不该盖掉登录错误 */ }
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
