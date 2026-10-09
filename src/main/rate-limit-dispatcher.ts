import { getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici'
import type { RateLimitMonitor } from './rate-limit-monitor'

/**
 * 额度采集的第二条通道：undici 全局 dispatcher。
 *
 * 只包 `globalThis.fetch` 会漏掉两类请求：一是 WebSocket 握手（undici 的 WebSocket 走内部
 * fetching，不经过全局 fetch），二是任何直接用 dispatcher 发出的请求。Codex（ChatGPT 账号）
 * 默认的传输就是 WebSocket，SSE 只是兜底，所以订阅额度头在那条路上一次都读不到——
 * 表现就是「用 OpenAI 账号聊了半天，上下文面板里没有 5 小时 / 周额度」。
 *
 * 这里只读响应头，不碰 body、不改请求，解析失败一律吞掉：额度是附带信息，
 * 绝不能影响这次模型请求本身。
 */

type RawHeaders = ReadonlyArray<Buffer | string>

function hostOf(origin: unknown): string | null {
  try {
    if (typeof origin === 'string') return new URL(origin).host
    if (origin instanceof URL) return origin.host
  } catch {
    return null
  }
  return null
}

/** 旧版 handler 的 rawHeaders 是 [键, 值, 键, 值…] 的 Buffer 数组。 */
export function headersFromRaw(raw: RawHeaders): Record<string, string> {
  const result: Record<string, string> = {}
  for (let index = 0; index + 1 < raw.length; index += 2) {
    result[String(raw[index]).toLowerCase()] = String(raw[index + 1])
  }
  return result
}

/** 新版 handler 的 headers 是对象；同名多值取第一个，额度头本来就是单值。 */
export function headersFromObject(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    result[key.toLowerCase()] = Array.isArray(value) ? value[0] ?? '' : value
  }
  return result
}

function methodNames(handler: object): string[] {
  const names = new Set<string>()
  for (let current: object | null = handler; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    for (const key of Object.getOwnPropertyNames(current)) {
      if (key !== 'constructor') names.add(key)
    }
  }
  return [...names]
}

/**
 * 复制一份 handler：方法一律绑回原对象，只在三个拿得到响应头的入口上加一次旁路。
 *
 * 不用 Proxy 是因为 undici 的内部 handler 用了私有字段，被代理对象当 `this` 调用时会直接抛
 * TypeError；绑回原对象就完全不碰这件事。
 */
function tapHandler(handler: Dispatcher.DispatchHandler, tap: (headers: Record<string, string>) => void): Dispatcher.DispatchHandler {
  const source = handler as unknown as Record<string, unknown>
  const wrapped: Record<string, unknown> = {}
  for (const key of methodNames(handler)) {
    const value = source[key]
    if (typeof value === 'function') wrapped[key] = (value as (...args: unknown[]) => unknown).bind(handler)
  }
  const onHeaders = source.onHeaders
  if (typeof onHeaders === 'function') {
    wrapped.onHeaders = (statusCode: number, rawHeaders: RawHeaders, ...rest: unknown[]) => {
      tap(headersFromRaw(rawHeaders ?? []))
      return (onHeaders as (...args: unknown[]) => unknown).call(handler, statusCode, rawHeaders, ...rest)
    }
  }
  // 升级为 WebSocket 时响应走这条路，同样带着完整的响应头。
  const onUpgrade = source.onUpgrade
  if (typeof onUpgrade === 'function') {
    wrapped.onUpgrade = (statusCode: number, rawHeaders: RawHeaders, ...rest: unknown[]) => {
      tap(headersFromRaw(rawHeaders ?? []))
      return (onUpgrade as (...args: unknown[]) => unknown).call(handler, statusCode, rawHeaders, ...rest)
    }
  }
  const onResponseStart = source.onResponseStart
  if (typeof onResponseStart === 'function') {
    wrapped.onResponseStart = (controller: unknown, statusCode: number, headers: Record<string, string | string[]>, ...rest: unknown[]) => {
      tap(headersFromObject(headers ?? {}))
      return (onResponseStart as (...args: unknown[]) => unknown).call(handler, controller, statusCode, headers, ...rest)
    }
  }
  return wrapped as unknown as Dispatcher.DispatchHandler
}

/** 组合进 dispatcher 的拦截器：请求原样透传，只顺手读一次响应头。 */
export function rateLimitInterceptor(monitor: Pick<RateLimitMonitor, 'capture'>) {
  return (dispatch: Dispatcher['dispatch']): Dispatcher['dispatch'] =>
    function interceptedDispatch(this: unknown, options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) {
      const host = hostOf((options as { origin?: unknown }).origin)
      if (!host || !handler) return dispatch.call(this, options, handler)
      const tap = (headers: Record<string, string>) => {
        try { monitor.capture(host, headers) } catch { /* 额度解析失败不能影响这次请求 */ }
      }
      return dispatch.call(this, options, tapHandler(handler, tap))
    }
}

/** 把旁路挂到当前全局 dispatcher 上；换代理后要再调一次，否则新的 dispatcher 上没有这层。 */
export function installRateLimitTap(monitor: Pick<RateLimitMonitor, 'capture'>) {
  setGlobalDispatcher(getGlobalDispatcher().compose(rateLimitInterceptor(monitor)))
}

/** 新建的代理 dispatcher 先套上旁路再设为全局，避免出现「换了代理额度就不更新了」。 */
export function withRateLimitTap(dispatcher: Dispatcher, monitor: Pick<RateLimitMonitor, 'capture'>): Dispatcher {
  return dispatcher.compose(rateLimitInterceptor(monitor))
}
