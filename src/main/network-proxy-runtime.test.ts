import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { NetworkProxyRuntime } from './network-proxy-runtime'

const original = getGlobalDispatcher()
afterEach(() => setGlobalDispatcher(original))

describe('network proxy replacement', () => {
  const dependencies = () => ({ env: {}, resolveSystemProxy: vi.fn(async () => 'DIRECT'), wrap: vi.fn((dispatcher) => dispatcher) })
  it('serializes writes and leaves the prior dispatcher on persistence failure', async () => {
    const runtime = new NetworkProxyRuntime(dependencies())
    const writes: string[] = []
    await runtime.apply({ mode: 'direct', proxyUrl: '' })
    const previous = getGlobalDispatcher()
    const first = runtime.apply({ mode: 'auto', proxyUrl: '' }, () => { writes.push('first'); throw new Error('disk') })
    await expect(first).rejects.toThrow('disk')
    expect(getGlobalDispatcher()).toBe(previous)
    await runtime.apply({ mode: 'direct', proxyUrl: '' }, () => { writes.push('second') })
    expect(writes).toEqual(['first', 'second'])
    await getGlobalDispatcher().close()
  })
  it('restores the original dispatcher if the first installation cannot persist', async () => {
    const runtime = new NetworkProxyRuntime(dependencies())
    await expect(runtime.apply({ mode: 'direct', proxyUrl: '' }, () => { throw new Error('disk') })).rejects.toThrow('disk')
    expect(getGlobalDispatcher()).toBe(original)
  })
  it('keeps in-flight response bodies alive when settings change', async () => {
    const server = createServer((_request, response) => { response.write('first'); setTimeout(() => response.end('second'), 40) })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const runtime = new NetworkProxyRuntime(dependencies())
    try {
      await runtime.apply({ mode: 'direct', proxyUrl: '' })
      const response = await fetch(`http://127.0.0.1:${address.port}`)
      await runtime.apply({ mode: 'auto', proxyUrl: '' })
      expect(await response.text()).toBe('firstsecond')
      expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe('firstsecond')
    } finally {
      await getGlobalDispatcher().close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
  it('sends a non-local request through a configured HTTP proxy', async () => {
    const upstream = createServer((_request, response) => response.end('via proxy'))
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const upstreamPort = (upstream.address() as { port: number }).port
    const proxy = createServer()
    let connectCount = 0
    proxy.on('connect', (_request, client) => {
      connectCount++
      const server = connect(upstreamPort, '127.0.0.1')
      server.once('connect', () => client.write('HTTP/1.1 200 Connection Established\r\n\r\n'))
      client.pipe(server).pipe(client)
    })
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    const proxyPort = (proxy.address() as { port: number }).port
    try {
      const runtime = new NetworkProxyRuntime(dependencies())
      await runtime.apply({ mode: 'manual', proxyUrl: `http://127.0.0.1:${proxyPort}` })
      const response = await fetch('http://example.invalid/test')
      expect(await response.text()).toBe('via proxy')
      expect(connectCount).toBe(1)
    } finally {
      await getGlobalDispatcher().close()
      await Promise.all([
        new Promise<void>((resolve) => proxy.close(() => resolve())),
        new Promise<void>((resolve) => upstream.close(() => resolve()))
      ])
    }
  })
})
