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

  it('自建网关的模型按标识从全目录补窗口，带厂商前缀也能匹配', async () => {
    const saved = vi.fn((input) => ({ ...input, id: 'connection' }))
    const store = { save: saved, resolve: () => ({ metadata: { providerId: 'custom', baseUrl: 'https://gateway.example.com/v1', protocol: 'openai' }, secrets: {} }) } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, {
      createRuntime: async () => ({ getModels: () => [{ id: 'glm-5.3', provider: 'zai', contextWindow: 1_000_000, maxTokens: 98_304 }] }) as any
    })
    await service.save({ providerId: 'custom', authMode: 'api-key', models: [{ modelId: 'zai-org/GLM-5.3' }, { modelId: 'glm-5.3' }, { modelId: 'never-heard-of-it' }] })
    const models = saved.mock.calls[0][0].models
    expect(models[0]).toMatchObject({ contextWindow: 1_000_000, maxTokens: 98_304 })
    expect(models[1]).toMatchObject({ contextWindow: 1_000_000 })
    // 目录里没有的模型不猜窗口：交给运行时按模型名推断，别伪造一个来源
    expect(models[2].contextWindow).toBeUndefined()
  })

  it('用户或网关已声明的窗口不被目录覆盖', async () => {
    const saved = vi.fn((input) => ({ ...input, id: 'connection' }))
    const store = { save: saved, resolve: () => ({ metadata: { providerId: 'custom', baseUrl: 'https://gateway.example.com/v1', protocol: 'openai' }, secrets: {} }) } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, {
      createRuntime: async () => ({ getModels: () => [{ id: 'glm-5.3', provider: 'zai', contextWindow: 1_000_000, maxTokens: 98_304 }] }) as any
    })
    await service.save({ providerId: 'custom', authMode: 'api-key', models: [{ modelId: 'glm-5.3', contextWindow: 65_536 }] })
    expect(saved.mock.calls[0][0].models[0]).toMatchObject({ contextWindow: 65_536 })
  })

  it('列连接时回填存量模型缺失的窗口，已有值不动', async () => {
    const setModelContextWindow = vi.fn()
    const store = {
      list: () => [{
        id: 'connection', providerId: 'custom', authMode: 'api-key' as const, models: [
          { id: -7, model_name: 'zai-org/GLM-5.3', model_kind: 'chat' as const },
          { id: -8, model_name: 'glm-5.3', model_kind: 'chat' as const, context_window: 65_536 }
        ]
      }],
      setModelContextWindow,
      setModelKind: vi.fn()
    } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, {
      createRuntime: async () => ({ getModels: () => [{ id: 'glm-5.3', provider: 'zai', contextWindow: 1_000_000, maxTokens: 98_304, input: ['text'] }] }) as any
    })
    const connections = await service.list()
    expect(connections[0].models[0].context_window).toBe(1_000_000)
    expect(connections[0].models[1].context_window).toBe(65_536)
    expect(setModelContextWindow.mock.calls).toEqual([[7, 1_000_000]])
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

describe('模型服务导入导出', () => {
  const API_KEY = 'sk-export-secret'
  function archiveStore(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      list: () => [
        { id: 'a', providerId: 'deepseek', name: 'DeepSeek', authMode: 'api-key', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai', hasCredentials: true, models: [] },
        { id: 'b', providerId: 'openai', name: 'OpenAI 账号', authMode: 'oauth', baseUrl: 'https://api.openai.com/v1', protocol: 'openai', hasCredentials: true, models: [] }
      ],
      apiKeySecrets: vi.fn((id: string) => id === 'a' ? { apiKey: API_KEY } : {}),
      connectionModels: () => [{ modelId: 'deepseek-chat', name: 'DeepSeek Chat' }, { modelId: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }],
      metadata: () => ({ providerId: 'deepseek', authMode: 'api-key' }),
      ...overrides
    } as unknown as ModelConnectionStore
  }

  it('默认档不解密任何密钥，账号连接也不带凭据', () => {
    const store = archiveStore()
    const service = new ModelConnectionService(store)
    const text = service.exportConnections({ ids: ['a', 'b'], secrets: 'omit' })
    expect(text).not.toContain(API_KEY)
    expect(store.apiKeySecrets).not.toHaveBeenCalled()
    expect(JSON.parse(text).connections).toHaveLength(2)
  })

  it('加密档带出 API Key，账号连接标记为不含密钥', () => {
    const service = new ModelConnectionService(archiveStore())
    const text = service.exportConnections({ ids: ['a', 'b'], secrets: 'encrypted', passphrase: 'pass' })
    expect(text).not.toContain(API_KEY)
    const archive = service.previewArchive(text, 'pass')
    expect(archive.connections.map((entry) => entry.hasSecrets)).toEqual([true, false])
  })

  it('导入按勾选落地，同名连接另存为副本', () => {
    const save = vi.fn(() => ({ id: 'new' }))
    const onChanged = vi.fn()
    const service = new ModelConnectionService(archiveStore({ save }), { onChanged })
    const text = service.exportConnections({ ids: ['a', 'b'], secrets: 'plain' })
    expect(service.importConnections(text, { indexes: [0] })).toBe(1)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'deepseek', name: 'DeepSeek (2)', apiKey: API_KEY }))
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('没有勾选任何连接时拒绝导出', () => {
    expect(() => new ModelConnectionService(archiveStore()).exportConnections({ ids: [], secrets: 'omit' })).toThrow('请至少勾选一个模型服务')
  })

  it('账号连接没有可回显的 API Key', () => {
    const service = new ModelConnectionService(archiveStore({ metadata: () => ({ providerId: 'openai', authMode: 'oauth' }) }))
    expect(() => service.revealApiKey('b')).toThrow('账号连接没有可查看的 API Key')
  })

  it('只导出勾选的连接内模型', () => {
    const service = new ModelConnectionService(archiveStore())
    const text = service.exportConnections({ ids: ['a'], modelIds: { a: ['deepseek-reasoner'] }, secrets: 'omit' })
    expect(service.previewArchive(text).connections[0].models.map((model) => model.modelId)).toEqual(['deepseek-reasoner'])
  })

  it('导入时只落地勾选的模型', () => {
    const save = vi.fn(() => ({ id: 'new' }))
    const service = new ModelConnectionService(archiveStore({ save }))
    const text = service.exportConnections({ ids: ['a'], secrets: 'omit' })
    service.importConnections(text, { indexes: [0], modelIds: { 0: ['deepseek-chat'] } })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ models: [expect.objectContaining({ modelId: 'deepseek-chat' })] }))
  })
})

