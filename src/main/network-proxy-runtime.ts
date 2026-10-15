/**
 * 把全局 dispatcher 换成按目标路由的代理 dispatcher。
 *
 * Electron 的 Chromium（应用窗口、系统浏览器）走系统代理，Node 侧的 fetch 不走。
 * OAuth 令牌交换与模型请求都在主进程用 fetch 发：用户开着系统代理登录 OpenAI 时，
 * 浏览器那一步经代理成功拿到授权码，随后的令牌交换却直连上游被拦（HTTP 403），
 * 表现就是「网页已认证成功但应用登录失败」。换上代理 dispatcher，两边才走同一条出口。
 *
 * 全局 dispatcher 对 Node 内置 fetch 生效：内置 undici 与外部 undici 共用
 * `Symbol.for('undici.globalDispatcher.1')` 这一个全局槽位。
 */
import { Agent, Dispatcher, ProxyAgent, fetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import type { NetworkProxyRoute, NetworkProxySettings, NetworkProxyState, NetworkProxyTestResult } from '../shared/types'
import { validateNetworkProxySettings } from '../shared/network-settings'
import { classifyNetworkFailure, networkTestTargets, redactProxyUrl, resolveNetworkRoute } from './network-routing'

export interface NetworkProxyDependencies {
  env: NodeJS.ProcessEnv
  resolveSystemProxy(target: string): Promise<string>
  wrap(dispatcher: Dispatcher): Dispatcher
}

export class NetworkRoutingDispatcher extends Dispatcher {
  private readonly direct = new Agent()
  private readonly proxies = new Map<string, ProxyAgent>()
  private readonly pending = new Set<Promise<void>>()
  private retiring = false
  constructor(readonly settings: NetworkProxySettings, private readonly deps: NetworkProxyDependencies) { super() }
  route(target: string) {
    return new Promise<Awaited<ReturnType<typeof resolveNetworkRoute>>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new DOMException('代理解析超时', 'TimeoutError')), 10000)
      void resolveNetworkRoute(this.settings, target, this.deps.env, this.deps.resolveSystemProxy)
        .then(resolve, reject).finally(() => clearTimeout(timer))
    })
  }
  dispatcherForRoute(route: NetworkProxyRoute): Dispatcher {
    if (!route.proxyUrl) return this.direct
    let proxy = this.proxies.get(route.proxyUrl)
    if (!proxy) { proxy = new ProxyAgent(route.proxyUrl); this.proxies.set(route.proxyUrl, proxy) }
    return proxy
  }
  override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    if (this.retiring) { handler.onError?.(new Error('代理配置已更新，请重试')); return false }
    const task = this.route(String(options.origin)).then((route) => {
      this.dispatcherForRoute(route).dispatch(options, handler)
    }).catch((error: Error) => handler.onError?.(error)).then(() => {})
    this.pending.add(task)
    void task.finally(() => this.pending.delete(task))
    return true
  }
  override async close(): Promise<void> {
    this.retiring = true
    await Promise.all(this.pending)
    await Promise.all([this.direct.close(), ...[...this.proxies.values()].map((proxy) => proxy.close())])
  }
  override async destroy(): Promise<void> {
    this.retiring = true
    await Promise.all(this.pending)
    await Promise.all([this.direct.destroy(), ...[...this.proxies.values()].map((proxy) => proxy.destroy())])
  }
}

export class NetworkProxyRuntime {
  private current: NetworkRoutingDispatcher | null = null
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly deps: NetworkProxyDependencies) {}
  private create(settings: NetworkProxySettings) { return new NetworkRoutingDispatcher(settings, this.deps) }
  apply(settings: NetworkProxySettings, persist?: (settings: NetworkProxySettings) => void): Promise<void> {
    const task = this.queue.catch(() => {}).then(() => {
      const next = this.create(validateNetworkProxySettings(settings))
      const previous = this.current
      const previousGlobal = getGlobalDispatcher()
      try {
        setGlobalDispatcher(this.deps.wrap(next))
        persist?.(next.settings)
        this.current = next
      } catch (error) {
        setGlobalDispatcher(previousGlobal)
        void next.close().catch(() => {})
        throw error
      }
      // close 等待在途请求完成；不能 destroy，否则会打断正在流式输出的会话。
      if (previous) void previous.close().catch(() => {})
    })
    this.queue = task
    return task
  }
  async state(settings: NetworkProxySettings): Promise<NetworkProxyState> {
    const dispatcher = this.create(settings)
    try {
      const routes = await Promise.all(networkTestTargets.map(async (target) => {
        try {
          const route = await dispatcher.route(target)
          return { target, ...route, proxyUrl: redactProxyUrl(route.proxyUrl) }
        } catch {
          return { target, source: settings.mode === 'manual' ? 'manual' as const : settings.mode === 'direct' ? 'direct' as const : 'system' as const, proxyUrl: null, error: '代理解析失败，请使用 HTTP / HTTPS 代理或测试连接查看诊断' }
        }
      }))
      return { settings, routes }
    } finally { await dispatcher.close() }
  }
  async test(settings: NetworkProxySettings): Promise<NetworkProxyTestResult[]> {
    const dispatcher = this.create(validateNetworkProxySettings(settings))
    try {
      return await Promise.all(networkTestTargets.map(async (target) => {
        const start = performance.now()
        const environmentProxy = this.deps.env.https_proxy || this.deps.env.HTTPS_PROXY || this.deps.env.http_proxy || this.deps.env.HTTP_PROXY || this.deps.env.all_proxy || this.deps.env.ALL_PROXY
        let route: NetworkProxyRoute = { source: settings.mode === 'manual' ? 'manual' : settings.mode === 'direct' ? 'direct' : environmentProxy ? 'environment' : 'system', proxyUrl: null }
        let resolved = false
        let status: number | null = null
        let failure: NetworkProxyTestResult['failure'] = null
        try {
          route = await dispatcher.route(target)
          resolved = true
          const signal = AbortSignal.timeout(Math.max(1, Math.floor(10000 - (performance.now() - start))))
          const response = await fetch(target, { dispatcher: dispatcher.dispatcherForRoute(route), signal, redirect: 'manual', method: 'HEAD' })
          status = response.status
          await response.body?.cancel()
          failure = status === 407 ? 'proxy_auth' : [401, 403].includes(status) ? 'auth' : status >= 500 ? 'upstream' : null
        } catch (error) { failure = classifyNetworkFailure(error, route.proxyUrl !== null || !resolved) }
        return { target, ...route, proxyUrl: redactProxyUrl(route.proxyUrl), elapsedMs: Math.round(performance.now() - start), status, failure }
      }))
    } finally { await dispatcher.destroy() }
  }
}
