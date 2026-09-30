import { describe, expect, it, vi } from 'vitest'
import { CredentialSynchronizationError } from '@earendil-works/pi-coding-agent'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelConnectionService } from './model-connections'
import type { ModelConnectionStore } from './local-store/model-connections'

describe('账号授权完成边界', () => {
  const credential = { type: 'oauth' as const, access: 'test-access', refresh: 'test-refresh', expires: Date.now() + 3600_000 }

  it('凭据已提交但运行时快照同步失败时保留授权成功', async () => {
    const credentials = new InMemoryCredentialStore()
    const onChanged = vi.fn()
    const store = { save: () => ({ id: 'a' }), credentials: () => credentials } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, { onChanged, createRuntime: async (guarded) => ({ login: async () => {
      await guarded.modify('openai-codex', async () => credential)
      throw new CredentialSynchronizationError('openai-codex', 'login', credential, { cause: new Error('snapshot failed') })
    } }) as any })
    try {
      const state = await service.startLogin('openai')
      await vi.waitFor(async () => expect((await service.authState(state.sessionId)).status).toBe('success'))
      expect(onChanged).toHaveBeenCalledOnce()
      expect((await service.authState(state.sessionId)).message).toContain('模型状态同步失败')
      expect(await credentials.read('openai-codex')).toEqual(credential)
    } finally { service.dispose() }
  })

  it('旧凭据不能掩盖本次令牌交换失败', async () => {
    const credentials = new InMemoryCredentialStore()
    await credentials.modify('openai-codex', async () => credential)
    const store = { metadata: () => ({ providerId: 'openai', authMode: 'oauth' }), credentials: () => credentials } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, { createRuntime: async () => ({ login: async () => {
      throw new Error('OpenAI Codex token exchange failed (400): secret-response')
    } }) as any })
    try {
      const state = await service.startLogin('openai', 'a')
      await vi.waitFor(async () => expect((await service.authState(state.sessionId)).status).toBe('error'))
      expect((await service.authState(state.sessionId)).error).toContain('令牌交换失败（HTTP 400）')
      expect((await service.authState(state.sessionId)).error).not.toContain('secret-response')
    } finally { service.dispose() }
  })

  it.each(['cancelled', 'expired'] as const)('登录%s后迟到的令牌不能落库或改成成功', async (status) => {
    vi.useFakeTimers()
    const credentials = new InMemoryCredentialStore()
    let complete!: () => void
    let settled!: () => void
    const finished = new Promise<void>((resolve) => { settled = resolve })
    const store = { save: () => ({ id: 'a' }), credentials: () => credentials } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, { createRuntime: async (guarded) => ({ login: async () => {
      try {
        await new Promise<void>((resolve) => { complete = resolve })
        await guarded.modify('openai-codex', async () => credential)
      } finally { settled() }
    } }) as any })
    try {
      const state = await service.startLogin('openai')
      if (status === 'cancelled') await service.cancelLogin(state.sessionId)
      else await vi.advanceTimersByTimeAsync(10 * 60_000)
      complete()
      await finished
      expect((await service.authState(state.sessionId)).status).toBe(status)
      expect(await credentials.read('openai-codex')).toBeUndefined()
    } finally { service.dispose(); vi.useRealTimers() }
  })

  it('浏览器回调撤销手动输入不应取消令牌交换', async () => {
    const credentials = new InMemoryCredentialStore()
    const store = { save: () => ({ id: 'a' }), credentials: () => credentials } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, { createRuntime: async (guarded) => ({ login: async (_p: string, _t: string, interaction: any) => {
      const manualAbort = new AbortController()
      const manual = interaction.prompt({ type: 'manual_code', message: 'code', signal: manualAbort.signal }).catch(() => {})
      manualAbort.abort()
      await manual
      expect(interaction.signal.aborted).toBe(false)
      await guarded.modify('openai-codex', async () => credential)
    } }) as any })
    try {
      const state = await service.startLogin('openai')
      await vi.waitFor(async () => expect((await service.authState(state.sessionId)).status).toBe('success'))
      expect((await service.authState(state.sessionId)).prompt).toBeUndefined()
    } finally { service.dispose() }
  })
})

describe('登录有效期与并发', () => {
  function serviceWithDeviceFlow() {
    const credentials = new InMemoryCredentialStore()
    let capture!: (interaction: { notify: (event: unknown) => void }) => void
    const captured = new Promise<{ notify: (event: unknown) => void }>((resolve) => { capture = resolve })
    const store = { save: () => ({ id: 'a' }), credentials: () => credentials } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, { createRuntime: async () => ({ login: async (_p: string, _t: string, interaction: any) => {
      capture(interaction)
      await new Promise<void>(() => {})
    } }) as any })
    return { service, captured }
  }

  it('厂商有效期短于默认值时按厂商截止时间过期', async () => {
    vi.useFakeTimers()
    const { service, captured } = serviceWithDeviceFlow()
    try {
      const state = await service.startLogin('openai')
      const { notify } = await captured
      notify({ type: 'device_code', userCode: 'CODE', verificationUri: 'https://verify.example.com', expiresInSeconds: 120 })
      await vi.advanceTimersByTimeAsync(9 * 60_000)
      expect((await service.authState(state.sessionId)).status).toBe('expired')
    } finally { service.dispose(); vi.useRealTimers() }
  })

  it('厂商有效期长于默认值时覆盖 10 分钟默认截止时间', async () => {
    vi.useFakeTimers()
    const { service, captured } = serviceWithDeviceFlow()
    try {
      const state = await service.startLogin('openai')
      const { notify } = await captured
      notify({ type: 'device_code', userCode: 'CODE', verificationUri: 'https://verify.example.com', expiresInSeconds: 15 * 60 })
      await vi.advanceTimersByTimeAsync(10.5 * 60_000)
      expect((await service.authState(state.sessionId)).status).toBe('pending')
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect((await service.authState(state.sessionId)).status).toBe('expired')
    } finally { service.dispose(); vi.useRealTimers() }
  })

  it.each([0, -5, Number.NaN, 24 * 60 * 60] as const)('无效或超上限的有效期 %s 回退默认或封顶', async (expiresInSeconds) => {
    vi.useFakeTimers()
    const { service, captured } = serviceWithDeviceFlow()
    try {
      const state = await service.startLogin('openai')
      const { notify } = await captured
      notify({ type: 'device_code', userCode: 'CODE', verificationUri: 'https://verify.example.com', expiresInSeconds })
      await vi.advanceTimersByTimeAsync(9.5 * 60_000)
      expect((await service.authState(state.sessionId)).status).toBe('pending')
      await vi.advanceTimersByTimeAsync(6 * 60_000)
      expect((await service.authState(state.sessionId)).status).toBe('expired')
    } finally { service.dispose(); vi.useRealTimers() }
  })

  it('同一厂商在途登录期间拒绝再次发起登录', async () => {
    const credentials = new InMemoryCredentialStore()
    const store = { save: () => ({ id: 'a' }), credentials: () => credentials } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, { createRuntime: async () => ({ login: async () => { await new Promise<void>(() => {}) } }) as any })
    try {
      const state = await service.startLogin('openai')
      await expect(service.startLogin('openai')).rejects.toThrow('已有进行中的账号登录')
      await service.cancelLogin(state.sessionId)
      await expect(service.startLogin('openai')).resolves.toBeDefined()
    } finally { service.dispose() }
  })
})

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
