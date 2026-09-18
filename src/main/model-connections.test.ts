import { describe, expect, it, vi } from 'vitest'
import { ModelConnectionService } from './model-connections'
import type { ModelConnectionStore } from './local-store/model-connections'

describe('连接模型发现', () => {
  it('账号模型发现保留思考映射', async () => {
    const thinkingLevelMap = { minimal: null, xhigh: 'xhigh' }
    const store = { metadata: () => ({ providerId: 'openai' }), credentials: () => ({}) } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, {
      createRuntime: async () => ({ getModels: () => [{ id: 'model', name: 'Model', reasoning: true, thinkingLevelMap, thinkingDefault: 'medium', thinkingProfiles: { medium: {} } }] }) as any
    })
    await expect(service.models({ id: 'connection', providerId: 'openai', authMode: 'oauth' })).resolves.toEqual([
      expect.objectContaining({ modelId: 'model', thinkingLevelMap, thinkingDefault: 'medium', thinkingProfiles: { medium: {} } })
    ])
  })

  it('API Key 发现与手动保存按厂商目录匹配能力，未知模型不猜高级档', async () => {
    const thinkingLevelMap = { xhigh: 'xhigh' }
    const saved = vi.fn((input) => ({ ...input, id: 'connection' }))
    const store = { save: saved, resolve: () => ({ metadata: { providerId: 'openai', baseUrl: 'https://example.com/v1', protocol: 'openai' }, secrets: {} }) } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, {
      createRuntime: async () => ({ getModels: () => [{ id: 'known', provider: 'openai', reasoning: true, thinkingLevelMap, thinkingDefault: 'high', thinkingProfiles: { high: {} } }] }) as any,
      fetch: vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: 'known' }, { id: 'unknown' }] }) })) as any
    })
    const models = await service.models({ providerId: 'openai', authMode: 'api-key' })
    expect(models[0]).toMatchObject({ reasoning: true, thinkingLevelMap, thinkingDefault: 'high', thinkingProfiles: { high: {} } })
    expect(models[1].thinkingLevelMap).toBeUndefined()
    await service.save({ providerId: 'openai', authMode: 'api-key', models: [{ modelId: 'known' }] })
    expect(saved.mock.calls[0][0].models[0]).toMatchObject({ reasoning: true, thinkingLevelMap, thinkingDefault: 'high', thinkingProfiles: { high: {} } })
  })

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

  it('收到授权地址后自动打开系统浏览器，重复通知不重复打开', async () => {
    const store = { save: () => ({ id: 'connection-a' }), metadata: () => ({ providerId: 'openai', authMode: 'oauth' }), credentials: () => ({ modify: vi.fn() }) } as unknown as ModelConnectionStore
    const runtime = { login: vi.fn(async (_p, _t, interaction) => {
      interaction.notify({ type: 'auth_url', url: 'https://auth.example.com/authorize', instructions: '请完成授权' })
      interaction.notify({ type: 'auth_url', url: 'https://auth.example.com/authorize', instructions: '请完成授权' })
      await new Promise(() => {})
    }) }
    const openExternal = vi.fn()
    const service = new ModelConnectionService(store, { createRuntime: async () => runtime as any, openExternal })
    const state = await service.startLogin('openai')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith('https://auth.example.com/authorize')
    expect((await service.authState(state.sessionId)).url).toBe('https://auth.example.com/authorize')
    await service.cancelLogin(state.sessionId)
  })
})
