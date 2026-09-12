import { unzipSync } from 'fflate'

/**
 * Hub 的唯一出网点。所有远端源都必须经过这里，
 * 目录数据里带来的 URL 与用户手填的源地址走不同宽严度的校验。
 */

export interface FetchLimits {
  /** 响应体上限，超出直接中断，不把整个仓库拉进内存 */
  maxBytes: number
  timeoutMs: number
  maxRedirects: number
}

export const DEFAULT_FETCH_LIMITS: FetchLimits = {
  maxBytes: 32 * 1024 * 1024,
  timeoutMs: 20_000,
  maxRedirects: 5
}

export interface ArchiveLimits {
  maxEntries: number
  maxTotalBytes: number
  maxEntryBytes: number
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 2000,
  maxTotalBytes: 64 * 1024 * 1024,
  maxEntryBytes: 8 * 1024 * 1024
}

const PRIVATE_IPV4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./
]

const PRIVATE_HOST_SUFFIX = ['.local', '.internal', '.localhost', '.home.arpa']

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || PRIVATE_HOST_SUFFIX.some((suffix) => host.endsWith(suffix))) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return PRIVATE_IPV4.some((pattern) => pattern.test(host))
  if (host.includes(':')) return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)
  return false
}

/**
 * 目录数据里的 URL 一律走默认严格档：仅 https、禁私网、禁 URL 内嵌凭据。
 * 用户自己填的源地址可以放开私网（内网 Git 服务器是正当用法），但那是用户的显式选择。
 */
export function assertSafeRemoteUrl(raw: string, options: { allowPrivateHost?: boolean; allowHttp?: boolean } = {}): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`不是合法的 URL：${raw}`)
  }
  const httpAllowed = options.allowHttp && url.protocol === 'http:'
  if (url.protocol !== 'https:' && !httpAllowed) throw new Error(`只允许 https 地址：${raw}`)
  if (url.username || url.password) throw new Error('URL 不能内嵌用户名或密码')
  if (!options.allowPrivateHost && isPrivateHost(url.hostname)) throw new Error(`拒绝访问内网地址：${url.hostname}`)
  return url
}

export interface FetchOptions {
  signal: AbortSignal
  headers?: Record<string, string>
  limits?: Partial<FetchLimits>
  allowPrivateHost?: boolean
  allowHttp?: boolean
  /** 注入点，测试不打真网 */
  fetchImpl?: typeof fetch
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`响应体超过 ${maxBytes} 字节上限`)
  const body = response.body
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    // 服务端可以不给 content-length，边收边算才拦得住。
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error(`响应体超过 ${maxBytes} 字节上限`)
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

/**
 * 手动跟随重定向：每一跳都要重新过 URL 校验，
 * 否则一个 https 的公网地址可以把我们 302 到 http://169.254.169.254。
 */
export async function fetchBuffer(rawUrl: string, options: FetchOptions): Promise<Uint8Array> {
  const limits = { ...DEFAULT_FETCH_LIMITS, ...options.limits }
  const request = options.fetchImpl ?? fetch
  let target = assertSafeRemoteUrl(rawUrl, { allowPrivateHost: options.allowPrivateHost, allowHttp: options.allowHttp })
  const timeout = AbortSignal.timeout(limits.timeoutMs)
  const signal = AbortSignal.any([options.signal, timeout])

  for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
    const response = await request(target, { headers: options.headers, redirect: 'manual', signal })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`${target.href} 返回 ${response.status} 但没有 Location`)
      // 跳转后的地址一律按严格档校验，不继承用户对源地址的私网放行。
      target = assertSafeRemoteUrl(new URL(location, target).href)
      continue
    }
    if (!response.ok) throw new Error(`请求失败 ${response.status}：${target.href}`)
    return await readCapped(response, limits.maxBytes)
  }
  throw new Error(`重定向超过 ${limits.maxRedirects} 次：${rawUrl}`)
}

export async function fetchJson<T>(url: string, options: FetchOptions): Promise<T> {
  const buffer = await fetchBuffer(url, { ...options, headers: { accept: 'application/json', ...options.headers } })
  const text = new TextDecoder('utf8').decode(buffer)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`响应不是合法 JSON：${url}`)
  }
}

/**
 * 解压 ZIP。fflate 的 filter 在解压每一条之前调用，
 * 在这里累计 originalSize 才能在真正展开之前拦住 zip bomb。
 */
export function extractArchive(data: Uint8Array, limits: Partial<ArchiveLimits> = {}): Record<string, Uint8Array> {
  const bounds = { ...DEFAULT_ARCHIVE_LIMITS, ...limits }
  let entries = 0
  let total = 0
  return unzipSync(data, {
    filter: (file) => {
      if (file.name.endsWith('/')) return false
      entries += 1
      if (entries > bounds.maxEntries) throw new Error(`压缩包条目数超过 ${bounds.maxEntries} 上限`)
      if (file.originalSize !== undefined) {
        if (file.originalSize > bounds.maxEntryBytes) throw new Error(`压缩包内 ${file.name} 超过单文件 ${bounds.maxEntryBytes} 字节上限`)
        total += file.originalSize
        if (total > bounds.maxTotalBytes) throw new Error(`压缩包解压后超过 ${bounds.maxTotalBytes} 字节上限`)
      }
      return true
    }
  })
}
