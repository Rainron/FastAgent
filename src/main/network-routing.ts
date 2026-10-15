/**
 * 按真实请求目标决定主进程出网走哪条路：直连、手动代理、环境变量代理或系统 PAC。
 *
 * 与旧的启动时算一次不同，这里每个请求都带上目标，PAC 才能按目标返回不同结果；
 * localhost / 127.* / ::1 无条件绕过，自动模式另外遵循 NO_PROXY。
 */
import type { NetworkFailure, NetworkProxyRoute, NetworkProxySettings } from '../shared/types'

export const networkTestTargets = ['https://auth.openai.com/', 'https://api.openai.com/']

/** 补全缺省协议头：系统代理与 PAC 只给 host:port，undici 要求带 scheme。只接受 http(s)，socks 一律拒绝。 */
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

export function redactProxyUrl(value: string | null): string | null {
  if (!value) return null
  try { const url = new URL(value); return `${url.protocol}//${url.host}/` } catch { return null }
}

export function bypassProxy(target: URL, noProxy: string): boolean {
  const host = target.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host)) return true
  const port = target.port || (target.protocol === 'https:' ? '443' : '80')
  return noProxy.split(/[\s,]+/).filter(Boolean).some((entry) => {
    if (entry === '*') return true
    const match = entry.toLowerCase().match(/^(.*?)(?::(\d+))?$/)!
    if (match[2] && match[2] !== port) return false
    const name = match[1].replace(/^\*?\./, '').replace(/^\[|\]$/g, '')
    return host === name || host.endsWith(`.${name}`)
  })
}

export async function resolveNetworkRoute(settings: NetworkProxySettings, target: string, env: NodeJS.ProcessEnv, resolve: (target: string) => Promise<string>): Promise<NetworkProxyRoute> {
  const url = new URL(target)
  if (settings.mode === 'direct') return { source: 'direct', proxyUrl: null }
  if (bypassProxy(url, settings.mode === 'manual' ? '' : env.no_proxy ?? env.NO_PROXY ?? '')) return { source: 'bypass', proxyUrl: null }
  if (settings.mode === 'manual') return { source: 'manual', proxyUrl: settings.proxyUrl }
  const raw = url.protocol === 'https:'
    ? env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY || env.all_proxy || env.ALL_PROXY
    : env.http_proxy || env.HTTP_PROXY || env.all_proxy || env.ALL_PROXY
  if (raw?.trim()) {
    const proxyUrl = normalizeProxyUrl(raw)
    if (!proxyUrl) throw new Error('环境代理仅支持 HTTP / HTTPS，请使用 HTTP 代理端口')
    return { source: 'environment', proxyUrl }
  }
  const resolved = await resolve(target)
  for (const entry of resolved.split(';')) {
    const [type, address] = entry.trim().split(/\s+/)
    if (type === 'DIRECT') return { source: 'system', proxyUrl: null }
    if (['PROXY', 'HTTP', 'HTTPS'].includes(type) && address) {
      const proxyUrl = normalizeProxyUrl(type === 'HTTPS' ? `https://${address}` : address)
      if (proxyUrl) return { source: 'system', proxyUrl }
    } else if (type?.startsWith('SOCKS')) throw new Error('系统代理为 SOCKS，请切换到代理软件的 HTTP 端口')
  }
  return { source: 'system', proxyUrl: null }
}

export function classifyNetworkFailure(error: unknown, proxied: boolean): NetworkFailure {
  let current = error
  const codes: string[] = []
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const item = current as { code?: string; name?: string; message?: string; cause?: unknown }
    codes.push(item.code ?? '', item.name ?? '', item.message ?? '')
    current = item.cause
  }
  const code = codes.join(' ')
  if (/TIMEOUT|AbortError|TimeoutError|ETIMEDOUT/.test(code)) return 'timeout'
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return 'dns'
  if (/CERT|TLS|SSL/.test(code)) return 'tls'
  if (proxied && /407|PROXY_AUTH|Proxy Authentication Required/i.test(code)) return 'proxy_auth'
  return proxied ? 'proxy' : 'upstream'
}
