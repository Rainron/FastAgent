import { describe, expect, it, vi } from 'vitest'
import { fetch, getGlobalDispatcher } from 'undici'
import { NetworkProxyRuntime } from './network-proxy-runtime'

vi.mock('undici', async (importOriginal) => {
  const original = await importOriginal<typeof import('undici')>()
  return { ...original, fetch: vi.fn() }
})

describe('isolated network diagnostics', () => {
  it('uses per-target routes without installing a global dispatcher or sending credentials', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 403, body: null } as Awaited<ReturnType<typeof fetch>>)
    const resolve = vi.fn(async (target: string) => target.includes('auth.') ? 'DIRECT' : 'PROXY proxy:8080')
    const wrap = vi.fn((dispatcher) => dispatcher)
    const runtime = new NetworkProxyRuntime({ env: {}, resolveSystemProxy: resolve, wrap })
    const previous = getGlobalDispatcher()
    const results = await runtime.test({ mode: 'auto', proxyUrl: '' })
    expect(results.map((result) => result.target)).toEqual(['https://auth.openai.com/', 'https://api.openai.com/'])
    expect(results.map((result) => result.proxyUrl)).toEqual([null, 'http://proxy:8080/'])
    expect(results.every((result) => result.status === 403 && result.failure === 'auth')).toBe(true)
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(wrap).not.toHaveBeenCalled()
    expect(getGlobalDispatcher()).toBe(previous)
    for (const [, options] of vi.mocked(fetch).mock.calls) {
      expect(options).toMatchObject({ method: 'HEAD', redirect: 'manual' })
      expect(options?.headers).toBeUndefined()
    }
  })
  it('never exposes environment proxy credentials', async () => {
    vi.mocked(fetch).mockRejectedValue({ cause: { code: 'ECONNREFUSED' } })
    const runtime = new NetworkProxyRuntime({ env: { HTTPS_PROXY: 'http://user:secret@proxy:8080' }, resolveSystemProxy: async () => 'DIRECT', wrap: (dispatcher) => dispatcher })
    const results = await runtime.test({ mode: 'auto', proxyUrl: '' })
    expect(results.every((result) => result.proxyUrl === 'http://proxy:8080/' && result.source === 'environment' && result.failure === 'proxy')).toBe(true)
    expect(JSON.stringify(results)).not.toContain('secret')
  })
})
