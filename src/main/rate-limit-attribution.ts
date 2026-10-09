import type { ModelConnectionSummary, RateLimitSnapshot } from '../shared/types'
import type { HostRateLimit } from './rate-limit-monitor'

/**
 * 额度快照按主机名归属到订阅连接。
 *
 * 订阅账号的真实请求域名未必等于连接里配的 baseUrl（Codex 配的是 api.openai.com，
 * 实际请求打的是 chatgpt.com 的 backend-api），所以除了按 baseUrl 匹配，还认一张已知域名表。
 */
const KNOWN_SUBSCRIPTION_HOSTS: Record<string, string> = {
  'chatgpt.com': 'openai',
  'api.openai.com': 'openai',
  'api.kimi.com': 'kimi-coding',
  'kimi.com': 'kimi-coding'
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/** `api.kimi.com` 命中 `kimi.com` 这类后缀关系也算同一家，但不能让 `evilkimi.com` 蒙混过去。 */
function hostMatches(host: string, candidate: string): boolean {
  return host === candidate || host.endsWith(`.${candidate}`)
}

/**
 * 只保留能归属到「账号订阅连接」的快照：
 * API Key 连接是按量付费，显示「已用百分比」没有意义，也不是用户要的东西。
 */
export function attributeRateLimits(snapshots: HostRateLimit[], connections: ModelConnectionSummary[]): RateLimitSnapshot[] {
  const subscriptions = connections.filter((connection) => connection.authMode === 'oauth')
  const result: RateLimitSnapshot[] = []
  for (const snapshot of snapshots) {
    if (!snapshot.primary && !snapshot.secondary) continue
    const byBaseUrl = subscriptions.find((connection) => {
      const host = hostOf(connection.baseUrl)
      return host ? hostMatches(snapshot.host, host) : false
    })
    const knownProvider = Object.entries(KNOWN_SUBSCRIPTION_HOSTS)
      .find(([candidate]) => hostMatches(snapshot.host, candidate))?.[1]
    const connection = byBaseUrl ?? (knownProvider ? subscriptions.find((item) => item.providerId === knownProvider) : undefined)
    if (!connection) continue
    result.push({
      connectionId: connection.id,
      label: connection.name || connection.providerId,
      primary: snapshot.primary,
      secondary: snapshot.secondary,
      capturedAt: snapshot.capturedAt
    })
  }
  // 同一个连接可能被多个域名命中（登录域与接口域），只留最新那份。
  const latest = new Map<string, RateLimitSnapshot>()
  for (const item of result) {
    const previous = latest.get(item.connectionId)
    if (!previous || previous.capturedAt < item.capturedAt) latest.set(item.connectionId, item)
  }
  return [...latest.values()]
}
