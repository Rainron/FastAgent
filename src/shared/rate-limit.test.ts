import { describe, expect, it } from 'vitest'
import { parseRateLimitHeaders, parseResetSeconds, resetLabel, windowLabel } from './rate-limit'

describe('parseRateLimitHeaders', () => {
  it('读 Codex 的百分比头，主次窗口各一份', () => {
    const result = parseRateLimitHeaders({
      'x-codex-primary-used-percent': '27',
      'x-codex-primary-window-minutes': '300',
      'x-codex-primary-reset-after-seconds': '16200',
      'x-codex-secondary-used-percent': '31',
      'x-codex-secondary-window-minutes': '10080'
    })
    expect(result?.primary).toEqual({ usedPercent: 27, windowMinutes: 300, resetsInSeconds: 16200 })
    expect(result?.secondary).toEqual({ usedPercent: 31, windowMinutes: 10080, resetsInSeconds: null })
  })

  it('头名大小写不敏感', () => {
    expect(parseRateLimitHeaders({ 'X-Codex-Primary-Used-Percent': '50' })?.primary?.usedPercent).toBe(50)
  })

  it('百分比夹在 0-100，越界数字不会把进度条画穿', () => {
    expect(parseRateLimitHeaders({ 'x-codex-primary-used-percent': '140' })?.primary?.usedPercent).toBe(100)
    expect(parseRateLimitHeaders({ 'x-codex-primary-used-percent': '-3' })?.primary?.usedPercent).toBe(0)
  })

  it('OpenAI 兼容配额头按剩余/上限折成已用比例', () => {
    const result = parseRateLimitHeaders({
      'x-ratelimit-limit-requests': '1000',
      'x-ratelimit-remaining-requests': '250',
      'x-ratelimit-reset-requests': '1m30s',
      'x-ratelimit-limit-tokens': '100',
      'x-ratelimit-remaining-tokens': '100'
    })
    expect(result?.primary).toEqual({ usedPercent: 75, windowMinutes: null, resetsInSeconds: 90 })
    expect(result?.secondary?.usedPercent).toBe(0)
  })

  it('Anthropic 配额头同样能读', () => {
    const result = parseRateLimitHeaders({ 'anthropic-ratelimit-requests-limit': '50', 'anthropic-ratelimit-requests-remaining': '40' })
    expect(result?.primary?.usedPercent).toBe(20)
  })

  it('没有任何额度头时返回 null，界面据此不显示这一段', () => {
    expect(parseRateLimitHeaders({ 'content-type': 'application/json' })).toBeNull()
  })

  it('上限为 0 或缺失时不折算，避免除零后画出 Infinity', () => {
    expect(parseRateLimitHeaders({ 'x-ratelimit-limit-requests': '0', 'x-ratelimit-remaining-requests': '0' })).toBeNull()
    expect(parseRateLimitHeaders({ 'x-ratelimit-remaining-requests': '5' })).toBeNull()
  })
})

describe('parseResetSeconds', () => {
  it('纯秒数直接用', () => {
    expect(parseResetSeconds('60')).toBe(60)
    expect(parseResetSeconds('0')).toBe(0)
  })

  it('带单位的时长按 h/m/s/ms 累加', () => {
    expect(parseResetSeconds('1m30s')).toBe(90)
    expect(parseResetSeconds('2h')).toBe(7200)
    expect(parseResetSeconds('500ms')).toBe(0.5)
  })

  it('解析不了就返回 null，不编一个假倒计时', () => {
    expect(parseResetSeconds('soon')).toBeNull()
    expect(parseResetSeconds(undefined)).toBeNull()
  })
})

describe('windowLabel', () => {
  it('整周整天整小时给人话', () => {
    expect(windowLabel(10080)).toBe('每周')
    expect(windowLabel(1440)).toBe('每天')
    expect(windowLabel(300)).toBe('5 小时')
    expect(windowLabel(45)).toBe('45 分钟')
  })

  it('没有窗口长度时返回 null，由界面退回中性说法', () => {
    expect(windowLabel(null)).toBeNull()
    expect(windowLabel(0)).toBeNull()
  })
})

describe('resetLabel', () => {
  const snapshot = { capturedAt: 1_000_000 }

  it('按快照时间往前推算真实剩余', () => {
    expect(resetLabel(snapshot, { usedPercent: 10, windowMinutes: 300, resetsInSeconds: 16200 }, snapshot.capturedAt)).toBe('4 小时 30 分后重置')
    // 快照过去 30 分钟后，倒计时要跟着减
    expect(resetLabel(snapshot, { usedPercent: 10, windowMinutes: 300, resetsInSeconds: 16200 }, snapshot.capturedAt + 1_800_000)).toBe('4 小时后重置')
  })

  it('已过期说即将重置，不显示负数', () => {
    expect(resetLabel(snapshot, { usedPercent: 10, windowMinutes: 300, resetsInSeconds: 60 }, snapshot.capturedAt + 600_000)).toBe('即将重置')
  })

  it('没有秒数就不给倒计时', () => {
    expect(resetLabel(snapshot, { usedPercent: 10, windowMinutes: 300, resetsInSeconds: null }, snapshot.capturedAt)).toBeNull()
  })
})
