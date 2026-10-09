import { describe, expect, it } from 'vitest'
import { buildPreviewFileUrl, checkLocalPreviewUrl, isLoopbackHttpUrl, isPreviewablePath, parsePreviewFileUrl, rootToken } from './preview-url'

describe('rootToken', () => {
  it('同一根目录得到同一主机名，格式可做合法主机名', () => {
    const token = rootToken('K:/work/demo', 'win32')
    expect(token).toMatch(/^w-[0-9a-f]{16}$/)
    expect(rootToken('K:/work/demo', 'win32')).toBe(token)
  })

  it('Windows 下大小写不敏感，POSIX 下敏感', () => {
    expect(rootToken('K:/Work/Demo', 'win32')).toBe(rootToken('k:/work/demo', 'win32'))
    expect(rootToken('/srv/Demo', 'linux')).not.toBe(rootToken('/srv/demo', 'linux'))
  })

  it('不同根落在不同源上', () => {
    expect(rootToken('K:/a', 'win32')).not.toBe(rootToken('K:/b', 'win32'))
  })
})

describe('buildPreviewFileUrl / parsePreviewFileUrl', () => {
  const token = 'w-0123456789abcdef'

  it('往返保持路径，特殊字符逐段编码', () => {
    const url = buildPreviewFileUrl(token, '.fastagent\\previews/我的 页面#1/index.html')
    expect(url).toBe(`fa-preview://${token}/.fastagent/previews/${encodeURIComponent('我的 页面#1')}/index.html`)
    expect(parsePreviewFileUrl(url)).toEqual({ token, relativePath: '.fastagent/previews/我的 页面#1/index.html' })
  })

  it('根路径解析为空串', () => {
    expect(parsePreviewFileUrl(`fa-preview://${token}/`)).toEqual({ token, relativePath: '' })
  })

  it('字面 .. 被 URL 解析器折叠在主机名之内，出不了根', () => {
    expect(parsePreviewFileUrl(`fa-preview://${token}/a/../../etc/passwd`)).toEqual({ token, relativePath: 'etc/passwd' })
  })

  it('编码形式的穿越与分隔符一律拒绝', () => {
    expect(parsePreviewFileUrl(`fa-preview://${token}/a/%2e%2e%2f%2e%2e%2fsecret`)).toBeNull()
    expect(parsePreviewFileUrl(`fa-preview://${token}/a%5c..%5csecret`)).toBeNull()
    expect(parsePreviewFileUrl(`fa-preview://${token}/a%00b`)).toBeNull()
    expect(parsePreviewFileUrl(`fa-preview://${token}/%E0%A4%A`)).toBeNull()
  })

  it('非本协议或主机名格式不对的拒绝', () => {
    expect(parsePreviewFileUrl('file:///C:/a.html')).toBeNull()
    expect(parsePreviewFileUrl('fa-preview://evil/a.html')).toBeNull()
    expect(parsePreviewFileUrl('not a url')).toBeNull()
  })
})

describe('checkLocalPreviewUrl', () => {
  it('放行 localhost / 127.0.0.1 / [::1]', () => {
    expect(checkLocalPreviewUrl('http://localhost:5173/')).toEqual({ ok: true, url: 'http://localhost:5173/' })
    expect(checkLocalPreviewUrl('https://127.0.0.1:8443/app?x=1')).toEqual({ ok: true, url: 'https://127.0.0.1:8443/app?x=1' })
    expect(checkLocalPreviewUrl('http://[::1]:3000')).toEqual({ ok: true, url: 'http://[::1]:3000/' })
  })

  it('0.0.0.0 改写为 127.0.0.1', () => {
    expect(checkLocalPreviewUrl(' http://0.0.0.0:4000/ ')).toEqual({ ok: true, url: 'http://127.0.0.1:4000/' })
  })

  it('拒绝外网、局域网与非 http 协议', () => {
    expect(checkLocalPreviewUrl('https://example.com').ok).toBe(false)
    expect(checkLocalPreviewUrl('http://192.168.1.10:3000').ok).toBe(false)
    expect(checkLocalPreviewUrl('http://localhost.evil.com').ok).toBe(false)
    expect(checkLocalPreviewUrl('file:///C:/a.html').ok).toBe(false)
    expect(checkLocalPreviewUrl('javascript:alert(1)').ok).toBe(false)
    expect(checkLocalPreviewUrl('::::').ok).toBe(false)
  })

  it('拒绝带账号密码的地址', () => {
    expect(checkLocalPreviewUrl('http://user:pass@localhost:3000').ok).toBe(false)
  })

  it('应用自身界面的端口在任一回环写法下都拒绝', () => {
    const blocked = ['http://127.0.0.1:5173']
    expect(checkLocalPreviewUrl('http://localhost:5173/', blocked).ok).toBe(false)
    expect(checkLocalPreviewUrl('http://127.0.0.1:5173/#/x', blocked).ok).toBe(false)
    expect(checkLocalPreviewUrl('http://localhost:5174/', blocked).ok).toBe(true)
  })
})

describe('辅助判断', () => {
  it('可渲染的文件类型', () => {
    expect(isPreviewablePath('a/index.HTML')).toBe(true)
    expect(isPreviewablePath('logo.svg')).toBe(true)
    expect(isPreviewablePath('main.ts')).toBe(false)
  })

  it('回环 http 地址判断', () => {
    expect(isLoopbackHttpUrl('http://localhost:3000/x')).toBe(true)
    expect(isLoopbackHttpUrl('fa-preview://w-0123456789abcdef/')).toBe(false)
    expect(isLoopbackHttpUrl('https://example.com')).toBe(false)
  })
})
