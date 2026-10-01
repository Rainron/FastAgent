import { describe, expect, it, vi } from 'vitest'
import { applyOutboundProxy, decideProxy, normalizeProxyUrl, proxyFromResolved } from './network-proxy'

describe('出网代理决策', () => {
  it('环境变量优先于系统代理', () => {
    expect(decideProxy({ HTTPS_PROXY: 'http://127.0.0.1:7890' }, 'PROXY 127.0.0.1:10808')).toEqual({ kind: 'env' })
    expect(decideProxy({ https_proxy: ' ' }, 'DIRECT')).toEqual({ kind: 'direct' })
  })

  it('取 PAC 结果里第一条可用代理并补全协议头', () => {
    expect(proxyFromResolved('PROXY 127.0.0.1:10808;DIRECT')).toEqual({ kind: 'proxy', url: 'http://127.0.0.1:10808/' })
    expect(proxyFromResolved('DIRECT;PROXY proxy.internal:3128')).toEqual({ kind: 'proxy', url: 'http://proxy.internal:3128/' })
    expect(proxyFromResolved('HTTPS proxy.internal:3129')).toEqual({ kind: 'proxy', url: 'https://proxy.internal:3129/' })
  })

  it('socks 代理标为不支持，避免装上一个必然失败的 dispatcher', () => {
    expect(proxyFromResolved('SOCKS5 127.0.0.1:10808')).toEqual({ kind: 'unsupported', scheme: 'SOCKS5' })
  })

  it('没有代理时判直连', () => {
    expect(proxyFromResolved('DIRECT')).toEqual({ kind: 'direct' })
    expect(proxyFromResolved('')).toEqual({ kind: 'direct' })
    expect(proxyFromResolved('PROXY')).toEqual({ kind: 'direct' })
  })

  it('只接受 http(s) 代理地址', () => {
    expect(normalizeProxyUrl('127.0.0.1:10808')).toBe('http://127.0.0.1:10808/')
    expect(normalizeProxyUrl('socks5://127.0.0.1:10808')).toBeNull()
    expect(normalizeProxyUrl('  ')).toBeNull()
  })
})

describe('出网代理安装', () => {
  const options = (overrides: Partial<Parameters<typeof applyOutboundProxy>[0]> = {}) => ({
    env: {} as NodeJS.ProcessEnv,
    resolveSystemProxy: async () => 'DIRECT',
    applyEnvProxy: vi.fn(),
    applyProxy: vi.fn(),
    log: vi.fn(),
    ...overrides
  })

  it('系统代理装上 dispatcher', async () => {
    const input = options({ resolveSystemProxy: async () => 'PROXY 127.0.0.1:10808' })
    expect(await applyOutboundProxy(input)).toEqual({ kind: 'proxy', url: 'http://127.0.0.1:10808/' })
    expect(input.applyProxy).toHaveBeenCalledWith('http://127.0.0.1:10808/')
    expect(input.applyEnvProxy).not.toHaveBeenCalled()
  })

  it('有环境变量代理时不去问系统代理', async () => {
    const resolveSystemProxy = vi.fn(async () => 'PROXY 127.0.0.1:10808')
    const input = options({ env: { HTTP_PROXY: 'http://127.0.0.1:7890' }, resolveSystemProxy })
    expect(await applyOutboundProxy(input)).toEqual({ kind: 'env' })
    expect(input.applyEnvProxy).toHaveBeenCalled()
    expect(resolveSystemProxy).not.toHaveBeenCalled()
  })

  it('探测或安装失败时回落直连而不是抛出', async () => {
    const input = options({ resolveSystemProxy: async () => { throw new Error('session 未就绪') } })
    expect(await applyOutboundProxy(input)).toEqual({ kind: 'direct' })
    expect(input.applyProxy).not.toHaveBeenCalled()
    expect(input.log).toHaveBeenCalledWith(expect.stringContaining('回落直连'))
  })

  it('socks 代理不装 dispatcher，只提示改用 http 端口', async () => {
    const input = options({ resolveSystemProxy: async () => 'SOCKS5 127.0.0.1:10808' })
    expect(await applyOutboundProxy(input)).toEqual({ kind: 'unsupported', scheme: 'SOCKS5' })
    expect(input.applyProxy).not.toHaveBeenCalled()
    expect(input.log).toHaveBeenCalledWith(expect.stringContaining('http(s) 代理'))
  })
})
