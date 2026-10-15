import { describe, expect, it, vi } from 'vitest'
import { resolveNetworkRoute, classifyNetworkFailure, normalizeProxyUrl, redactProxyUrl, bypassProxy } from './network-routing'

describe('network routing', () => {
  const auto = { mode: 'auto' as const, proxyUrl: '' }
  it('bypasses loopback and NO_PROXY before resolving PAC', async () => {
    const resolve = vi.fn(async () => 'PROXY proxy.test:8080')
    expect((await resolveNetworkRoute(auto, 'http://127.0.0.1:3000', {}, resolve)).source).toBe('bypass')
    expect((await resolveNetworkRoute(auto, 'https://api.example.com', { NO_PROXY: '.example.com' }, resolve)).source).toBe('bypass')
    expect(resolve).not.toHaveBeenCalled()
  })
  it('environment takes priority per target protocol, then PAC per target', async () => {
    const resolve = vi.fn(async (target: string) => target.includes('auth.') ? 'DIRECT' : 'PROXY system:8080')
    expect(await resolveNetworkRoute(auto, 'https://api.openai.com', { HTTPS_PROXY: 'http://env:8080' }, resolve)).toEqual({ source: 'environment', proxyUrl: 'http://env:8080/' })
    expect(await resolveNetworkRoute(auto, 'http://api.example.com', { HTTPS_PROXY: 'http://secure:8080', HTTP_PROXY: 'http://plain:8080' }, resolve)).toEqual({ source: 'environment', proxyUrl: 'http://plain:8080/' })
    expect((await resolveNetworkRoute(auto, 'https://auth.openai.com', {}, resolve)).proxyUrl).toBeNull()
    expect((await resolveNetworkRoute(auto, 'https://api.openai.com', {}, resolve)).proxyUrl).toBe('http://system:8080/')
  })
  it('direct ignores environment and unsupported PAC fails actionably', async () => {
    expect((await resolveNetworkRoute({ mode: 'direct', proxyUrl: '' }, 'https://api.openai.com', { HTTPS_PROXY: 'http://env:8080' }, async () => 'DIRECT')).source).toBe('direct')
    await expect(resolveNetworkRoute(auto, 'https://api.openai.com', {}, async () => 'SOCKS5 host:1080')).rejects.toThrow('HTTP')
  })
  it('manual proxy overrides NO_PROXY except loopback', async () => {
    const manual = { mode: 'manual' as const, proxyUrl: 'http://manual:7890' }
    const env = { NO_PROXY: '*' }
    const resolve = vi.fn(async () => 'DIRECT')
    expect((await resolveNetworkRoute(manual, 'https://api.openai.com', env, resolve)).proxyUrl).toBe('http://manual:7890')
    expect((await resolveNetworkRoute(manual, 'http://localhost:3000', env, resolve)).source).toBe('bypass')
    expect(resolve).not.toHaveBeenCalled()
  })
  it('redacts secrets and classifies nested errors', () => {
    expect(redactProxyUrl('http://user:secret@proxy:8080/path?secret=123')).toBe('http://proxy:8080/')
    expect(classifyNetworkFailure({ cause: { code: 'ENOTFOUND' } }, false)).toBe('dns')
    expect(classifyNetworkFailure({ code: 'CERT_HAS_EXPIRED' }, true)).toBe('tls')
  })
  it('matches NO_PROXY domains and ports without bypassing unrelated suffixes', () => {
    expect(bypassProxy(new URL('https://api.example.com'), '.example.com:443')).toBe(true)
    expect(bypassProxy(new URL('https://api.example.com:444'), '.example.com:443')).toBe(false)
    expect(bypassProxy(new URL('https://notexample.com'), 'example.com')).toBe(false)
    expect(bypassProxy(new URL('http://[::1]:8000'), '')).toBe(true)
  })
  it('completes a missing scheme and only accepts http(s) proxy addresses', () => {
    expect(normalizeProxyUrl('127.0.0.1:10808')).toBe('http://127.0.0.1:10808/')
    expect(normalizeProxyUrl('http://proxy.test:3128')).toBe('http://proxy.test:3128/')
    expect(normalizeProxyUrl('socks5://127.0.0.1:10808')).toBeNull()
    expect(normalizeProxyUrl('https://')).toBeNull()
    expect(normalizeProxyUrl('  ')).toBeNull()
  })
})
