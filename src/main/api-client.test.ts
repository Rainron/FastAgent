import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from './api-client'

describe('ApiClient desktop resources', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses the public auth captcha endpoint used by the running backend', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { captcha_id: 'desktop-captcha', image: 'data:image/png;base64,AA==', expires_in: 180 }
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    await new ApiClient('https://agent.example').captcha()

    expect(fetch).toHaveBeenCalledWith(
      'https://agent.example/api/v1/auth/captcha',
      expect.objectContaining({ headers: expect.any(Headers) })
    )
  })

  it('bootstrap 一次性带回模型直连凭证', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {
        user: { id: '1', username: 'lake' },
        models: [{ id: 7, name: 'Demo' }],
        model_credentials: [{ id: 7, name: 'Demo', provider: 'openai', model_name: 'demo', base_url: 'https://provider.example/v1', api_key: 'sk-plain' }],
        schema_version: 'desktop-v3'
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    const result = await new ApiClient('https://agent.example', 'desktop-jwt').bootstrap()

    expect(result.model_credentials?.[0]).toMatchObject({ id: 7, api_key: 'sk-plain', base_url: 'https://provider.example/v1' })
    expect(fetch).toHaveBeenCalledWith('https://agent.example/api/v1/desktop/bootstrap', expect.objectContaining({ headers: expect.any(Headers) }))
  })

  it('bootstrap 旧服务回退只获取用户和模型', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/desktop/bootstrap')) return new Response(JSON.stringify({ message: 'missing' }), { status: 404 })
      if (url.endsWith('/chat/available-models')) return new Response(JSON.stringify({ data: { models: [], default_model_id: null } }), { status: 200 })
      if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ data: { id: '1', username: 'lake' } }), { status: 200 })
      return new Response('', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await new ApiClient('https://agent.example', 'token').bootstrap()

    expect(result).toMatchObject({ models: [], schema_version: 'legacy-models-only' })
    expect(fetchMock.mock.calls.map(([input]) => String(input)).some((url) => url.includes('/mcp/'))).toBe(false)
    expect(fetchMock.mock.calls.map(([input]) => String(input)).some((url) => url.includes('/skills/'))).toBe(false)
  })

  it('并发 401 只刷新一次并重放请求', async () => {
    const attempts = new Map<string, number>()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const count = (attempts.get(url) ?? 0) + 1
      attempts.set(url, count)
      return count === 1
        ? new Response(JSON.stringify({ message: 'expired' }), { status: 401 })
        : new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
    }))
    const client = new ApiClient('https://agent.example', 'expired')
    const refresh = vi.fn(async () => 'renewed')
    client.setUnauthorizedHandler(refresh)

    const values = await Promise.all([client.request<{ ok: boolean }>('/one'), client.request<{ ok: boolean }>('/two')])

    expect(values).toEqual([{ ok: true }, { ok: true }])
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
