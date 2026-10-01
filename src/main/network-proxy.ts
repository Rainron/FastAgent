/**
 * 主进程出网代理。
 *
 * Electron 的 Chromium（应用窗口、系统浏览器）走系统代理，Node 侧的 fetch 不走。
 * OAuth 令牌交换与模型请求都在主进程用 fetch 发：用户开着系统代理登录 OpenAI 时，
 * 浏览器那一步经代理成功拿到授权码，随后的令牌交换却直连上游被拦（HTTP 403），
 * 表现就是「网页已认证成功但应用登录失败」。把 undici 的全局 dispatcher 换成代理
 * dispatcher，两边才走同一条出口。
 *
 * 全局 dispatcher 对 Node 内置 fetch 生效：内置 undici 与外部 undici 共用
 * `Symbol.for('undici.globalDispatcher.1')` 这一个全局槽位。
 */

/** 环境变量优先于系统代理：显式配置的意图比系统设置更强。 */
const ENV_PROXY_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']

export type ProxyDecision =
  | { kind: 'env' }
  | { kind: 'proxy'; url: string }
  /** undici 只能代理 http(s)，socks 代理只能提示用户改用 http 端口。 */
  | { kind: 'unsupported'; scheme: string }
  | { kind: 'direct' }

export function hasEnvProxy(env: NodeJS.ProcessEnv): boolean {
  return ENV_PROXY_KEYS.some((key) => (env[key] ?? '').trim().length > 0)
}

/** 补全缺省协议头：系统代理只给 host:port，undici 要求带 scheme。 */
export function normalizeProxyUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (!url.hostname) return null
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * 解析 Electron `resolveProxy` 的 PAC 结果，取第一条能用的代理。
 * 形如 `PROXY 127.0.0.1:10808;DIRECT`、`SOCKS5 127.0.0.1:10808`、`DIRECT`。
 */
export function proxyFromResolved(resolved: string): ProxyDecision {
  for (const entry of resolved.split(';')) {
    const [rawType, rawTarget] = entry.trim().split(/\s+/, 2)
    const type = (rawType ?? '').toUpperCase()
    if (!type || type === 'DIRECT') continue
    const target = rawTarget?.trim()
    if (!target) continue
    if (type === 'PROXY' || type === 'HTTP') {
      const url = normalizeProxyUrl(target)
      if (url) return { kind: 'proxy', url }
      continue
    }
    if (type === 'HTTPS') {
      const url = normalizeProxyUrl(`https://${target}`)
      if (url) return { kind: 'proxy', url }
      continue
    }
    return { kind: 'unsupported', scheme: type }
  }
  return { kind: 'direct' }
}

export function decideProxy(env: NodeJS.ProcessEnv, resolved: string): ProxyDecision {
  return hasEnvProxy(env) ? { kind: 'env' } : proxyFromResolved(resolved)
}

export function describeProxyDecision(decision: ProxyDecision): string {
  if (decision.kind === 'env') return '出网代理 来自环境变量'
  if (decision.kind === 'proxy') return `出网代理 ${decision.url}`
  if (decision.kind === 'unsupported') return `出网代理 系统配置为 ${decision.scheme}，Node 侧只支持 http(s) 代理，请改用代理软件的 http 端口或设置 HTTPS_PROXY`
  return '出网代理 直连'
}

export interface OutboundProxyOptions {
  env: NodeJS.ProcessEnv
  /** 传 Electron 的 session.resolveProxy；探测失败时由调用方回落成 'DIRECT'。 */
  resolveSystemProxy: () => Promise<string>
  applyEnvProxy: () => void
  applyProxy: (url: string) => void
  log: (message: string) => void
}

/**
 * 决定并安装全局 dispatcher。任何一步失败都只记日志：
 * 代理装不上最多是回到现在的直连行为，不该拦住启动。
 */
export async function applyOutboundProxy(options: OutboundProxyOptions): Promise<ProxyDecision> {
  let decision: ProxyDecision = { kind: 'direct' }
  try {
    // 环境变量已经决定结果时不去问系统代理：resolveProxy 要等 session 就绪，白等一次。
    const resolved = hasEnvProxy(options.env) ? 'DIRECT' : await options.resolveSystemProxy()
    decision = decideProxy(options.env, resolved)
    if (decision.kind === 'env') options.applyEnvProxy()
    else if (decision.kind === 'proxy') options.applyProxy(decision.url)
  } catch (error) {
    options.log(`出网代理 配置失败，回落直连：${error instanceof Error ? error.message : String(error)}`)
    return { kind: 'direct' }
  }
  options.log(describeProxyDecision(decision))
  return decision
}
