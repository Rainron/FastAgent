/** 订阅额度快照：模型服务在响应头里报回来的窗口用量，读不到就没有。 */

export interface RateLimitWindow {
  /** 已用百分比，0-100。 */
  usedPercent: number
  /** 窗口长度（分钟）；厂商没给时为 null。 */
  windowMinutes: number | null
  /** 距离重置的秒数；厂商没给时为 null。 */
  resetsInSeconds: number | null
}

export interface RateLimitSnapshot {
  /** 连接 id；一个账号一条快照，多个订阅连接互不覆盖。 */
  connectionId: string
  /** 展示用的连接名。 */
  label: string
  /** 主窗口：Codex 是 5 小时额度，通用 API 是请求数配额。 */
  primary: RateLimitWindow | null
  /** 次窗口：Codex 是周额度，通用 API 是 token 配额。 */
  secondary: RateLimitWindow | null
  /** 抓到这份快照的时间戳；界面据此把 resetsInSeconds 换算成实时倒计时。 */
  capturedAt: number
}
