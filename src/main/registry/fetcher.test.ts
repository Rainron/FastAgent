import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { assertSafeRemoteUrl, extractArchive, fetchBuffer, fetchJson } from './fetcher'

function response(body: string | Uint8Array, init: { status?: number; headers?: Record<string, string> } = {}) {
  const payload = typeof body === 'string' ? new TextEncoder().encode(body) : body
  return new Response(payload as unknown as BodyInit, { status: init.status ?? 200, headers: init.headers })
}

describe('assertSafeRemoteUrl', () => {
  it('放行公网 https 地址', () => {
    expect(assertSafeRemoteUrl('https://example.com/a.json').host).toBe('example.com')
  })

  it('拒绝 http', () => {
    expect(() => assertSafeRemoteUrl('http://example.com')).toThrow('只允许 https')
  })

  it('用户显式放行时才接受 http 与内网地址', () => {
    expect(() => assertSafeRemoteUrl('http://192.168.1.10/git', { allowHttp: true })).toThrow('拒绝访问内网地址')
    expect(assertSafeRemoteUrl('http://192.168.1.10/git', { allowHttp: true, allowPrivateHost: true }).hostname).toBe('192.168.1.10')
  })

  it.each([
    'https://127.0.0.1/x',
    'https://10.1.2.3/x',
    'https://172.16.0.1/x',
    'https://192.168.0.1/x',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/x',
    'https://build.internal/x',
    'https://[::1]/x'
  ])('拒绝内网地址 %s', (url) => {
    expect(() => assertSafeRemoteUrl(url)).toThrow('拒绝访问内网地址')
  })

  it('放行与内网段相近但属于公网的地址', () => {
    expect(assertSafeRemoteUrl('https://172.32.0.1/x').hostname).toBe('172.32.0.1')
    expect(assertSafeRemoteUrl('https://11.0.0.1/x').hostname).toBe('11.0.0.1')
  })

  it('拒绝内嵌凭据的 URL', () => {
    expect(() => assertSafeRemoteUrl('https://user:pass@example.com')).toThrow('不能内嵌用户名或密码')
  })
})

describe('fetchBuffer', () => {
  const signal = new AbortController().signal

  it('读取正常响应', async () => {
    const fetchImpl = (async () => response('hello')) as unknown as typeof fetch
    const buffer = await fetchBuffer('https://example.com/a', { signal, fetchImpl })
    expect(new TextDecoder().decode(buffer)).toBe('hello')
  })

  it('content-length 超限时不读取正文', async () => {
    const fetchImpl = (async () => response('x', { headers: { 'content-length': '999' } })) as unknown as typeof fetch
    await expect(fetchBuffer('https://example.com/a', { signal, fetchImpl, limits: { maxBytes: 10 } })).rejects.toThrow('超过 10 字节上限')
  })

  it('未声明 content-length 时按实际收到的字节数拦截', async () => {
    const fetchImpl = (async () => response('0123456789abcdef')) as unknown as typeof fetch
    await expect(fetchBuffer('https://example.com/a', { signal, fetchImpl, limits: { maxBytes: 4 } })).rejects.toThrow('超过 4 字节上限')
  })

  it('重定向到内网地址被拦住', async () => {
    const fetchImpl = (async () => response('', { status: 302, headers: { location: 'https://169.254.169.254/' } })) as unknown as typeof fetch
    await expect(fetchBuffer('https://example.com/a', { signal, fetchImpl })).rejects.toThrow('拒绝访问内网地址')
  })

  it('重定向不继承源地址的私网放行', async () => {
    const fetchImpl = (async () => response('', { status: 302, headers: { location: 'https://10.0.0.5/' } })) as unknown as typeof fetch
    await expect(fetchBuffer('https://git.example.com/a', { signal, fetchImpl, allowPrivateHost: true })).rejects.toThrow('拒绝访问内网地址')
  })

  it('重定向次数超限时报错', async () => {
    const fetchImpl = (async () => response('', { status: 302, headers: { location: 'https://example.com/next' } })) as unknown as typeof fetch
    await expect(fetchBuffer('https://example.com/a', { signal, fetchImpl, limits: { maxRedirects: 2 } })).rejects.toThrow('重定向超过 2 次')
  })

  it('非 2xx 抛错', async () => {
    const fetchImpl = (async () => response('nope', { status: 404 })) as unknown as typeof fetch
    await expect(fetchBuffer('https://example.com/a', { signal, fetchImpl })).rejects.toThrow('请求失败 404')
  })
})

describe('fetchJson', () => {
  const signal = new AbortController().signal

  it('非 JSON 响应给出可定位的错误', async () => {
    const fetchImpl = (async () => response('<html>')) as unknown as typeof fetch
    await expect(fetchJson('https://example.com/a', { signal, fetchImpl })).rejects.toThrow('响应不是合法 JSON')
  })
})

describe('extractArchive', () => {
  const encode = (value: string) => new TextEncoder().encode(value)

  it('展开普通压缩包并跳过目录条目', () => {
    const zip = zipSync({ 'skill/SKILL.md': encode('---\nname: a\n---\n'), 'skill/ref.md': encode('x') })
    const files = extractArchive(zip)
    expect(Object.keys(files).sort()).toEqual(['skill/SKILL.md', 'skill/ref.md'])
  })

  it('条目数超限时抛错', () => {
    const payload: Record<string, Uint8Array> = {}
    for (let index = 0; index < 5; index += 1) payload[`f${index}.txt`] = encode('x')
    expect(() => extractArchive(zipSync(payload), { maxEntries: 3 })).toThrow('条目数超过 3 上限')
  })

  it('单文件解压后超限时抛错', () => {
    const zip = zipSync({ 'big.txt': encode('a'.repeat(500)) })
    expect(() => extractArchive(zip, { maxEntryBytes: 100 })).toThrow('超过单文件 100 字节上限')
  })

  it('解压总量超限时抛错', () => {
    const zip = zipSync({ 'a.txt': encode('a'.repeat(80)), 'b.txt': encode('b'.repeat(80)) })
    expect(() => extractArchive(zip, { maxTotalBytes: 100 })).toThrow('解压后超过 100 字节上限')
  })
})
