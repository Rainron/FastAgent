import { describe, expect, it, vi } from 'vitest'
import { createLazyModuleLoader } from './lazy-module'

describe('createLazyModuleLoader', () => {
  it('并发首次加载只执行一次 import', async () => {
    let resolveModule!: (value: { value: string }) => void
    const importModule = vi.fn(() => new Promise<{ value: string }>((resolve) => { resolveModule = resolve }))
    const load = createLazyModuleLoader(importModule)

    const first = load()
    const second = load()
    resolveModule({ value: 'loaded' })

    await expect(first).resolves.toEqual({ value: 'loaded' })
    await expect(second).resolves.toEqual({ value: 'loaded' })
    expect(importModule).toHaveBeenCalledTimes(1)
  })
})
