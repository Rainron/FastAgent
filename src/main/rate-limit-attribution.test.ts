import { describe, expect, it } from 'vitest'
import type { ModelConnectionSummary } from '../shared/types'
import { attributeRateLimits } from './rate-limit-attribution'
import type { HostRateLimit } from './rate-limit-monitor'

const connection = (patch: Partial<ModelConnectionSummary>): ModelConnectionSummary => ({
  id: 'c1', providerId: 'openai', name: 'ChatGPT 订阅', authMode: 'oauth', baseUrl: 'https://api.openai.com/v1',
  protocol: 'openai', hasCredentials: true, status: 'ready', models: [], updatedAt: '2026-09-17T00:00:00.000Z', ...patch
})

const snapshot = (patch: Partial<HostRateLimit>): HostRateLimit => ({
  host: 'chatgpt.com', primary: { usedPercent: 27, windowMinutes: 300, resetsInSeconds: 16200 }, secondary: null, capturedAt: 10, ...patch
})

describe('attributeRateLimits', () => {
  it('实际请求域名与 baseUrl 不同的订阅（Codex 走 chatgpt.com）也能归属', () => {
    const result = attributeRateLimits([snapshot({})], [connection({})])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ connectionId: 'c1', label: 'ChatGPT 订阅' })
  })

  it('按 baseUrl 主机名直接匹配', () => {
    const result = attributeRateLimits(
      [snapshot({ host: 'api.kimi.com' })],
      [connection({ id: 'c2', providerId: 'kimi-coding', name: 'Kimi Code', baseUrl: 'https://api.kimi.com/coding' })]
    )
    expect(result[0]?.connectionId).toBe('c2')
  })

  it('API Key 连接不显示额度：按量付费没有「已用百分比」这回事', () => {
    expect(attributeRateLimits([snapshot({})], [connection({ authMode: 'api-key' })])).toEqual([])
  })

  it('没有对应订阅连接时丢弃，不给无主的数字', () => {
    expect(attributeRateLimits([snapshot({ host: 'api.deepseek.com' })], [connection({})])).toEqual([])
  })

  it('相近域名不会被蒙混归属', () => {
    expect(attributeRateLimits([snapshot({ host: 'evil-chatgpt.com' })], [connection({})])).toEqual([])
  })

  it('同一连接被多个域名命中时只留最新那份', () => {
    const result = attributeRateLimits([
      snapshot({ host: 'api.openai.com', capturedAt: 10 }),
      snapshot({ host: 'chatgpt.com', capturedAt: 99, primary: { usedPercent: 55, windowMinutes: 300, resetsInSeconds: 60 } })
    ], [connection({})])
    expect(result).toHaveLength(1)
    expect(result[0].primary?.usedPercent).toBe(55)
  })

  it('两个窗口都没读到的快照不进结果', () => {
    expect(attributeRateLimits([snapshot({ primary: null, secondary: null })], [connection({})])).toEqual([])
  })
})
