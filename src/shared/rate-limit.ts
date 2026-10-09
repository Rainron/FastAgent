import type { RateLimitSnapshot, RateLimitWindow } from './types'

/**
 * 订阅额度的解析与文案。
 *
 * 只认响应里真实带回来的数字，读不到就是没有——不按本地用量倒推，
 * 那是我们自己的统计，不是厂商的剩余额度，两者混在一起会让用户按错的数字做决定。
 */

function num(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/** 头名大小写不敏感：不同 provider 大小写写法不一致，统一转小写再查。 */
function lower(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) result[key.toLowerCase()] = value
  return result
}

/**
 * Codex（ChatGPT 订阅）的 `x-codex-*` 头：直接给已用百分比与窗口长度，
 * 正是界面要显示的「5 小时 27%」「本周 31%」。
 */
function parseCodex(headers: Record<string, string>): { primary: RateLimitWindow | null; secondary: RateLimitWindow | null } | null {
  const read = (scope: 'primary' | 'secondary'): RateLimitWindow | null => {
    const used = num(headers[`x-codex-${scope}-used-percent`])
    if (used === null) return null
    return {
      usedPercent: clampPercent(used),
      windowMinutes: num(headers[`x-codex-${scope}-window-minutes`]),
      resetsInSeconds: num(headers[`x-codex-${scope}-reset-after-seconds`])
    }
  }
  const primary = read('primary')
  const secondary = read('secondary')
  return primary || secondary ? { primary, secondary } : null
}

/** 剩余/上限两个数字换算成已用百分比；上限为 0 时没有意义，按读不到处理。 */
function fromRemaining(remaining: number | null, limit: number | null, reset: number | null): RateLimitWindow | null {
  if (remaining === null || limit === null || limit <= 0) return null
  return { usedPercent: clampPercent(((limit - remaining) / limit) * 100), windowMinutes: null, resetsInSeconds: reset }
}

/** `x-ratelimit-*`：OpenAI 兼容接口（含 Moonshot / Kimi）常见的配额头。 */
function parseOpenAiStyle(headers: Record<string, string>): { primary: RateLimitWindow | null; secondary: RateLimitWindow | null } | null {
  const requests = fromRemaining(
    num(headers['x-ratelimit-remaining-requests'] ?? headers['x-ratelimit-remaining']),
    num(headers['x-ratelimit-limit-requests'] ?? headers['x-ratelimit-limit']),
    parseResetSeconds(headers['x-ratelimit-reset-requests'] ?? headers['x-ratelimit-reset'])
  )
  const tokens = fromRemaining(
    num(headers['x-ratelimit-remaining-tokens']),
    num(headers['x-ratelimit-limit-tokens']),
    parseResetSeconds(headers['x-ratelimit-reset-tokens'])
  )
  return requests || tokens ? { primary: requests, secondary: tokens } : null
}

/** Anthropic 的配额头；未来接 Claude 订阅时同一条路走。 */
function parseAnthropicStyle(headers: Record<string, string>): { primary: RateLimitWindow | null; secondary: RateLimitWindow | null } | null {
  const requests = fromRemaining(
    num(headers['anthropic-ratelimit-requests-remaining']),
    num(headers['anthropic-ratelimit-requests-limit']),
    null
  )
  const tokens = fromRemaining(
    num(headers['anthropic-ratelimit-tokens-remaining']),
    num(headers['anthropic-ratelimit-tokens-limit']),
    null
  )
  return requests || tokens ? { primary: requests, secondary: tokens } : null
}

/**
 * reset 头有两种写法：秒数（`60`）与带单位的时长（`1m30s`、`500ms`）。
 * 解析不了就返回 null，界面少显示一个倒计时，不编一个假的。
 */
export function parseResetSeconds(value: string | undefined): number | null {
  if (!value) return null
  const plain = Number(value)
  if (Number.isFinite(plain)) return plain
  const match = value.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/)
  if (!match || !match.slice(1).some(Boolean)) return null
  const [, hours, minutes, seconds, millis] = match
  return (Number(hours ?? 0) * 3600) + (Number(minutes ?? 0) * 60) + Number(seconds ?? 0) + (Number(millis ?? 0) / 1000)
}

/**
 * 从响应头解析额度窗口。按 Codex 专有头 → OpenAI 兼容头 → Anthropic 头的顺序试，
 * 都读不到时返回 null（该 provider 不报额度，界面就不显示这一段）。
 */
export function parseRateLimitHeaders(headers: Record<string, string>): { primary: RateLimitWindow | null; secondary: RateLimitWindow | null } | null {
  const normalized = lower(headers)
  return parseCodex(normalized) ?? parseOpenAiStyle(normalized) ?? parseAnthropicStyle(normalized)
}

/** 窗口长度 → 人话。厂商没给长度时返回 null，由界面退回「主/次额度」这类中性说法。 */
export function windowLabel(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null
  if (minutes % (60 * 24 * 7) === 0) {
    const weeks = minutes / (60 * 24 * 7)
    return weeks === 1 ? '每周' : `每 ${weeks} 周`
  }
  if (minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24)
    return days === 1 ? '每天' : `每 ${days} 天`
  }
  if (minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${Math.round(minutes)} 分钟`
}

/** 倒计时文案：`4 小时 30 分后重置`；秒数不可用时返回 null。 */
export function resetLabel(snapshot: Pick<RateLimitSnapshot, 'capturedAt'>, window: RateLimitWindow, now: number): string | null {
  if (window.resetsInSeconds === null) return null
  const remaining = window.resetsInSeconds - Math.max(0, (now - snapshot.capturedAt) / 1000)
  if (remaining <= 0) return '即将重置'
  const totalMinutes = Math.ceil(remaining / 60)
  if (totalMinutes < 60) return `${totalMinutes} 分钟后重置`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) return minutes ? `${hours} 小时 ${minutes} 分后重置` : `${hours} 小时后重置`
  const days = Math.floor(hours / 24)
  return `${days} 天后重置`
}
