import { describe, expect, it, vi } from 'vitest'
import { headersFromObject, headersFromRaw, rateLimitInterceptor } from './rate-limit-dispatcher'

const codexRaw = [Buffer.from('X-Codex-Primary-Used-Percent'), Buffer.from('27'), Buffer.from('x-codex-primary-window-minutes'), Buffer.from('300')]

describe('响应头归一', () => {
  it('rawHeaders 按键值对展开并统一小写', () => {
    expect(headersFromRaw(codexRaw)).toEqual({ 'x-codex-primary-used-percent': '27', 'x-codex-primary-window-minutes': '300' })
  })

  it('落单的键不产生半条记录', () => {
    expect(headersFromRaw([Buffer.from('x-codex-primary-used-percent')])).toEqual({})
  })

  it('对象形态取首个值，undefined 跳过', () => {
    expect(headersFromObject({ 'X-A': ['1', '2'], 'x-b': '3', 'x-c': undefined })).toEqual({ 'x-a': '1', 'x-b': '3' })
  })
})

describe('rateLimitInterceptor', () => {
  function runDispatch(handler: Record<string, unknown>, origin: string) {
    const monitor = { capture: vi.fn() }
    const inner = vi.fn((_options: unknown, wrapped: Record<string, unknown>) => wrapped)
    const dispatch = rateLimitInterceptor(monitor)(inner as never)
    const wrapped = dispatch.call(null, { origin, path: '/', method: 'GET' } as never, handler as never) as unknown as Record<string, (...args: unknown[]) => unknown>
    return { monitor, inner, wrapped }
  }

  it('旧版 handler：读一次响应头后原样转交', () => {
    const onHeaders = vi.fn(() => true)
    const { monitor, wrapped } = runDispatch({ onHeaders }, 'https://chatgpt.com')
    expect(wrapped.onHeaders(200, codexRaw, () => undefined, 'OK')).toBe(true)
    expect(monitor.capture).toHaveBeenCalledWith('chatgpt.com', { 'x-codex-primary-used-percent': '27', 'x-codex-primary-window-minutes': '300' })
    expect(onHeaders).toHaveBeenCalledWith(200, codexRaw, expect.any(Function), 'OK')
  })

  it('WebSocket 升级同样能读到额度头：Codex 默认就走这条路', () => {
    const onUpgrade = vi.fn()
    const socket = {}
    const { monitor, wrapped } = runDispatch({ onUpgrade }, 'https://chatgpt.com')
    wrapped.onUpgrade(101, codexRaw, socket)
    expect(monitor.capture).toHaveBeenCalledWith('chatgpt.com', expect.objectContaining({ 'x-codex-primary-used-percent': '27' }))
    expect(onUpgrade).toHaveBeenCalledWith(101, codexRaw, socket)
  })

  it('新版 handler 走 onResponseStart', () => {
    const onResponseStart = vi.fn()
    const controller = {}
    const { monitor, wrapped } = runDispatch({ onResponseStart }, 'https://api.kimi.com')
    wrapped.onResponseStart(controller, 200, { 'X-Codex-Primary-Used-Percent': '31' }, 'OK')
    expect(monitor.capture).toHaveBeenCalledWith('api.kimi.com', { 'x-codex-primary-used-percent': '31' })
    expect(onResponseStart).toHaveBeenCalledWith(controller, 200, { 'X-Codex-Primary-Used-Percent': '31' }, 'OK')
  })

  it('其余方法绑回原 handler，私有字段照常可用', () => {
    class Handler {
      #chunks: unknown[] = []
      onData(chunk: unknown) { this.#chunks.push(chunk); return true }
      seen() { return this.#chunks.length }
    }
    const handler = new Handler()
    const { wrapped } = runDispatch(handler as unknown as Record<string, unknown>, 'https://chatgpt.com')
    expect(() => wrapped.onData('a')).not.toThrow()
    expect(handler.seen()).toBe(1)
  })

  it('采集抛错不影响这次请求', () => {
    const monitor = { capture: vi.fn(() => { throw new Error('boom') }) }
    const onHeaders = vi.fn(() => true)
    const inner = vi.fn((_options: unknown, wrapped: Record<string, (...args: unknown[]) => unknown>) => wrapped)
    const dispatch = rateLimitInterceptor(monitor)(inner as never)
    const wrapped = dispatch.call(null, { origin: 'https://chatgpt.com', path: '/', method: 'GET' } as never, { onHeaders } as never) as unknown as Record<string, (...args: unknown[]) => unknown>
    expect(wrapped.onHeaders(200, codexRaw)).toBe(true)
  })

  it('拿不到主机名时完全不插手', () => {
    const handler = { onHeaders: vi.fn() }
    const monitor = { capture: vi.fn() }
    const inner = vi.fn((_options: unknown, passed: unknown) => passed)
    const dispatch = rateLimitInterceptor(monitor)(inner as never)
    const passed = dispatch.call(null, { origin: undefined, path: '/', method: 'GET' } as never, handler as never)
    expect(passed).toBe(handler)
    expect(monitor.capture).not.toHaveBeenCalled()
  })
})
