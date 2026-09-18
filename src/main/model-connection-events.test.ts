import { describe, expect, it, vi } from 'vitest'
import type { ModelConnectionStore } from './local-store/model-connections'
import { ModelConnectionService } from './model-connections'

describe('模型连接目录变更通知', () => {
  it('保存、删除与退出登录在持久化完成后通知', async () => {
    const changed = vi.fn()
    const store = {
      save: vi.fn(() => ({ id: 'a' })), remove: vi.fn(), metadata: () => ({ providerId: 'openai', authMode: 'oauth' }),
      credentials: () => ({ delete: vi.fn() })
    } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, { onChanged: changed })
    await service.save({ providerId: 'openai', authMode: 'oauth', models: [] })
    expect(changed).toHaveBeenCalledTimes(1)
    await service.remove('a')
    expect(changed).toHaveBeenCalledTimes(2)
    await service.logout('a')
    expect(changed).toHaveBeenCalledTimes(3)
  })

  it('后台登录成功会通知已打开窗口，无需界面轮询触发', async () => {
    const changed = vi.fn()
    const store = { metadata: () => ({ providerId: 'openai', authMode: 'oauth' }), credentials: () => ({ modify: vi.fn() }) } as unknown as ModelConnectionStore
    const service = new ModelConnectionService(store, { onChanged: changed, createRuntime: async () => ({ login: async () => {} }) as any })
    const state = await service.startLogin('openai', 'a')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect((await service.authState(state.sessionId)).status).toBe('success')
    expect(changed).toHaveBeenCalledOnce()
    service.dispose()
  })
})
