import { parseRateLimitHeaders } from '../shared/rate-limit'
import type { RateLimitWindow } from '../shared/types'

/**
 * 订阅额度监听。
 *
 * 模型请求由 pi 运行时自己发出，它不把响应头交出来，我们也不该为了看额度再去打一次厂商接口
 * （多打一次就多扣一次额度，还可能触发风控）。所以这里在主进程包一层 fetch：请求照常透传，
 * 只顺手读响应头里的额度字段。读不到就什么都不记，界面上那一段自然不出现。
 *
 * 只读 headers，不碰 body：body 是流，读了就会把模型输出吞掉。
 */

export interface HostRateLimit {
  host: string
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
  capturedAt: number
}

type Listener = (snapshots: HostRateLimit[]) => void

function hostOf(input: unknown): string | null {
  try {
    if (typeof input === 'string') return new URL(input).host
    if (input instanceof URL) return input.host
    if (input && typeof input === 'object' && 'url' in input) return new URL(String((input as { url: unknown }).url)).host
  } catch {
    return null
  }
  return null
}

function sameWindow(a: RateLimitWindow | null, b: RateLimitWindow | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.usedPercent === b.usedPercent && a.windowMinutes === b.windowMinutes && a.resetsInSeconds === b.resetsInSeconds
}

export class RateLimitMonitor {
  private readonly byHost = new Map<string, HostRateLimit>()
  private readonly listeners = new Set<Listener>()
  private installed = false

  /** 包一层全局 fetch；重复调用只生效一次，热重载时不会层层套娃。 */
  install(target: { fetch: typeof fetch } = globalThis as unknown as { fetch: typeof fetch }) {
    if (this.installed) return
    this.installed = true
    const original = target.fetch.bind(target)
    target.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const response = await original(input, init)
      try {
        this.capture(hostOf(input), response.headers)
      } catch {
        // 额度是附带信息，解析失败绝不能影响这次模型请求
      }
      return response
    }
  }

  capture(host: string | null, headers: Headers | Record<string, string>) {
    if (!host) return
    const plain: Record<string, string> = headers instanceof Headers
      ? Object.fromEntries([...headers.entries()])
      : headers
    const parsed = parseRateLimitHeaders(plain)
    if (!parsed) return
    const previous = this.byHost.get(host)
    const next: HostRateLimit = { host, primary: parsed.primary, secondary: parsed.secondary, capturedAt: Date.now() }
    this.byHost.set(host, next)
    // 数值没变就不广播：模型请求很密集，每次都推会让渲染层白重画。
    if (previous && sameWindow(previous.primary, next.primary) && sameWindow(previous.secondary, next.secondary)) return
    const all = this.list()
    for (const listener of this.listeners) listener(all)
  }

  list(): HostRateLimit[] {
    return [...this.byHost.values()]
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
