import { describe, expect, it, vi } from 'vitest'
import { ModelConnectionService } from './model-connections'
import type { ModelConnectionStore } from './local-store/model-connections'

describe('连接模型发现', () => {
  it('发现失败不返回上游含密钥的错误，允许调用方手动填写模型', async () => {
    const store = { resolve: () => ({ metadata: { baseUrl: 'https://example.com/v1', protocol: 'openai' }, secrets: { api_key: 'private-key' } }) } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, { fetch: vi.fn(async () => { throw new Error('private-key upstream') }) as typeof fetch })
    await expect(service.models({ providerId: 'custom', authMode: 'api-key' })).rejects.toThrow('模型列表获取失败，可手动填写模型标识')
  })
  it('取消账号登录不会保存后续返回的凭据', async () => {
    const modify = vi.fn()
    const store = { save: () => ({ id: 'connection-a' }), metadata: () => ({ providerId: 'openai', authMode: 'oauth' }), credentials: () => ({ modify }) } as unknown as ModelConnectionStore
    const runtime = { login: vi.fn(async (_p, _t, interaction) => { await interaction.prompt({ type: 'manual_code', message: 'code' }) }) }
    const service = new ModelConnectionService(store, { createRuntime: async () => runtime as any })
    const state = await service.startLogin('openai')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await service.cancelLogin(state.sessionId)
    expect((await service.authState(state.sessionId)).status).toBe('cancelled')
    expect(modify).not.toHaveBeenCalled()
  })
})
