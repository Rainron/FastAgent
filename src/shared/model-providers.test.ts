import { describe, expect, it } from 'vitest'
import { MODEL_PROVIDERS, normalizeConnectionEndpoint } from './model-providers'

describe('模型厂商连接预设', () => {
  it('覆盖主要厂商且只有实现了 OAuth 的厂商展示账号登录', () => {
    expect(MODEL_PROVIDERS.map((p) => p.id)).toEqual(expect.arrayContaining(['openai', 'qwen', 'zhipu', 'kimi', 'deepseek', 'minimax', 'custom']))
    expect(MODEL_PROVIDERS.filter((p) => p.authModes.includes('oauth')).every((p) => Boolean(p.oauthProviderId))).toBe(true)
  })
  it('Kimi Code 套餐账号登录映射到 pi 内置 kimi-coding', () => {
    const coding = MODEL_PROVIDERS.find((p) => p.id === 'kimi-coding')
    expect(coding).toMatchObject({ authModes: ['oauth'], oauthProviderId: 'kimi-coding' })
    expect(coding?.description).toContain('套餐')
  })
  it('原有 Kimi／Moonshot API Key 预设不受账号登录影响', () => {
    const kimi = MODEL_PROVIDERS.find((p) => p.id === 'kimi')
    expect(kimi).toMatchObject({ authModes: ['api-key'], baseUrl: 'https://api.moonshot.cn/v1' })
    expect(kimi?.oauthProviderId).toBeUndefined()
  })
  it('拒绝嵌入密码和非HTTP端点并规范化地址', () => {
    expect(normalizeConnectionEndpoint('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
    expect(() => normalizeConnectionEndpoint('https://user:password@example.com/v1')).toThrow()
    expect(() => normalizeConnectionEndpoint('file:///tmp/model')).toThrow()
  })
})
