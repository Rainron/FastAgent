import { describe, expect, it, vi } from 'vitest'
import { RateLimitMonitor } from './rate-limit-monitor'

const codexHeaders = (percent: string) => ({ 'x-codex-primary-used-percent': percent, 'x-codex-primary-window-minutes': '300' })

describe('RateLimitMonitor', () => {
  it('从响应头记录额度，按主机名归档', () => {
    const monitor = new RateLimitMonitor()
    monitor.capture('chatgpt.com', codexHeaders('27'))
    expect(monitor.list()).toHaveLength(1)
    expect(monitor.list()[0]).toMatchObject({ host: 'chatgpt.com', primary: { usedPercent: 27, windowMinutes: 300 } })
  })

  it('没有额度头时不留空记录', () => {
    const monitor = new RateLimitMonitor()
    monitor.capture('example.com', { 'content-type': 'application/json' })
    expect(monitor.list()).toEqual([])
  })

  it('数值没变不广播：模型请求很密集，重复推送只会让界面白重画', () => {
    const monitor = new RateLimitMonitor()
    const listener = vi.fn()
    monitor.onChange(listener)
    monitor.capture('chatgpt.com', codexHeaders('27'))
    monitor.capture('chatgpt.com', codexHeaders('27'))
    expect(listener).toHaveBeenCalledTimes(1)
    monitor.capture('chatgpt.com', codexHeaders('31'))
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('包装后的 fetch 原样返回响应，且只读 headers 不动 body', async () => {
    const monitor = new RateLimitMonitor()
    const body = 'hello'
    const response = new Response(body, { headers: codexHeaders('40') })
    const target = { fetch: vi.fn(async () => response) as unknown as typeof fetch }
    monitor.install(target)
    const returned = await target.fetch('https://chatgpt.com/backend-api/codex/responses')
    expect(returned).toBe(response)
    // body 没被提前读掉，调用方照常拿得到
    expect(await returned.text()).toBe(body)
    expect(monitor.list()[0]?.primary?.usedPercent).toBe(40)
  })

  it('解析失败不影响这次请求', async () => {
    const monitor = new RateLimitMonitor()
    const response = new Response('ok')
    const target = { fetch: vi.fn(async () => response) as unknown as typeof fetch }
    monitor.install(target)
    await expect(target.fetch('not a url')).resolves.toBe(response)
  })

  it('重复安装只包一层', async () => {
    const monitor = new RateLimitMonitor()
    const original = vi.fn(async () => new Response('ok', { headers: codexHeaders('10') }))
    const target = { fetch: original as unknown as typeof fetch }
    monitor.install(target)
    const wrapped = target.fetch
    monitor.install(target)
    expect(target.fetch).toBe(wrapped)
    await target.fetch('https://chatgpt.com/x')
    expect(original).toHaveBeenCalledTimes(1)
  })
})
