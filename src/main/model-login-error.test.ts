import { describe, expect, it } from 'vitest'
import { modelLoginError, modelLoginErrorDetail } from './model-login-error'

describe('账号登录错误诊断', () => {
  it.each([
    [new TypeError('fetch failed', { cause: Object.assign(new Error('private'), { code: 'ETIMEDOUT' }) }), '网络连接失败'],
    [new Error('OpenAI Codex token exchange failed (403): private-token'), '令牌交换失败（HTTP 403）'],
    [new Error('OpenAI Codex token exchange response missing fields: private-token'), '令牌响应不完整'],
    [new Error('Failed to extract accountId from token'), '账号信息解析失败'],
    [new Error('Credential store modify failed for openai-codex', { cause: new Error('private-token') }), '凭据保存失败'],
    [new Error('State mismatch'), '授权回调校验失败'],
    [new Error('Kimi Code device authorization failed with status 503: private-body'), 'Kimi Code 设备授权请求失败（HTTP 503）'],
    [new Error('Invalid Kimi Code device authorization response: {"private":"private-token"}'), 'Kimi Code 授权服务响应异常'],
    [new Error('Kimi Code device authorization expired. Please restart login.'), '设备验证码已过期'],
    [new Error('Kimi Code login was denied.'), '授权被拒绝'],
    [new Error('Kimi Code token refresh unauthorized (status 401)'), 'Kimi Code 授权已失效'],
    [new Error('Kimi Code device token request failed (status 500): {"private":"private-token"}'), 'Kimi Code 登录失败'],
    [new Error('private-token'), '账号登录失败'],
  ])('分类错误且不泄露上游响应', (error, expected) => {
    const message = modelLoginError(error)
    expect(message).toContain(expected)
    expect(message).not.toContain('private')
  })

  it('403 指向代理而不是账号权限', () => {
    expect(modelLoginError(new Error('OpenAI Codex token exchange failed (403): <html>Access denied</html>'))).toContain('代理')
  })

  it('Kimi 错误不展示 OpenAI 专用说明', () => {
    const message = modelLoginError(new Error('Kimi Code token exchange failed (400): private'))
    expect(message).not.toContain('Codex')
    expect(message).not.toContain('OpenAI')
  })
})

describe('登录错误的日志原文', () => {
  it('保留状态码与响应体，便于区分网络拦截和授权服务拒绝', () => {
    expect(modelLoginErrorDetail(new Error('OpenAI Codex token exchange failed (403): <html>Access denied</html>')))
      .toEqual({ message: 'OpenAI Codex token exchange failed (403): <html>Access denied</html>', status: 403 })
    expect(modelLoginErrorDetail(new Error('Kimi Code device authorization failed with status 503: busy')).status).toBe(503)
  })

  it('抹掉上游回显的凭据字段', () => {
    const detail = modelLoginErrorDetail(new Error('OpenAI Codex token exchange response missing fields: {"access_token":"secret-value","refresh_token":"secret-value","expires_in":null}'))
    expect(detail.message).not.toContain('secret-value')
    expect(detail.message).toContain('"access_token":"***"')
    expect(detail.message).toContain('expires_in')
  })

  it('超长响应体截断，不把整页 HTML 写进日志', () => {
    const detail = modelLoginErrorDetail(new Error(`OpenAI Codex token exchange failed (403): ${'x'.repeat(2000)}`))
    expect(detail.message.length).toBeLessThanOrEqual(301)
    expect(detail.message.endsWith('…')).toBe(true)
  })
})
