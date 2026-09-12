import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStreamBuffer } from './stream-buffer'

describe('createStreamBuffer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('间隔内的多个 token 合并成一次冲刷', () => {
    const onFlush = vi.fn()
    const buffer = createStreamBuffer(onFlush, 60)
    buffer.push('turn-1', 'a')
    buffer.push('turn-1', 'b')
    buffer.push('turn-1', 'c')
    expect(onFlush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith([{ turnId: 'turn-1', text: 'abc' }])
  })

  it('不同回合分别累积', () => {
    const onFlush = vi.fn()
    const buffer = createStreamBuffer(onFlush, 60)
    buffer.push('turn-1', 'a')
    buffer.push('turn-2', 'x')
    vi.advanceTimersByTime(60)
    expect(onFlush).toHaveBeenCalledWith([{ turnId: 'turn-1', text: 'a' }, { turnId: 'turn-2', text: 'x' }])
  })

  it('flush 立即冲刷并取消待触发的定时器', () => {
    const onFlush = vi.fn()
    const buffer = createStreamBuffer(onFlush, 60)
    buffer.push('turn-1', 'a')
    buffer.flush()
    expect(onFlush).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(120)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  it('没有积压时 flush 不触发回调', () => {
    const onFlush = vi.fn()
    createStreamBuffer(onFlush, 60).flush()
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('dispose 后不再冲刷', () => {
    const onFlush = vi.fn()
    const buffer = createStreamBuffer(onFlush, 60)
    buffer.push('turn-1', 'a')
    buffer.dispose()
    vi.advanceTimersByTime(120)
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('空字符串不建立定时器', () => {
    const onFlush = vi.fn()
    const buffer = createStreamBuffer(onFlush, 60)
    buffer.push('turn-1', '')
    vi.advanceTimersByTime(120)
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('思考阶段缓存回答，结束后才释放', () => {
    const onFlush = vi.fn()
    const buffer = createStreamBuffer(onFlush, 60)
    buffer.markThinking('turn-1')
    buffer.push('turn-1', 'answer')
    vi.advanceTimersByTime(120)
    expect(onFlush).not.toHaveBeenCalled()
    buffer.markThinkingEnded('turn-1')
    vi.advanceTimersByTime(60)
    expect(onFlush).toHaveBeenCalledWith([{ turnId: 'turn-1', text: 'answer' }])
  })

  it('终止刷新会释放尚未收到思考结束事件的回答', () => {
    const onFlush = vi.fn()
    const buffer = createStreamBuffer(onFlush, 60)
    buffer.markThinking('turn-1')
    buffer.push('turn-1', 'answer')
    buffer.flush()
    expect(onFlush).toHaveBeenCalledWith([{ turnId: 'turn-1', text: 'answer' }])
  })

  it('浏览器中自定义长间隔使用定时器批量冲刷', () => {
    const requestAnimationFrame = vi.fn()
    vi.stubGlobal('window', { requestAnimationFrame, cancelAnimationFrame: vi.fn() })
    const onFlush = vi.fn()
    const buffer = createStreamBuffer(onFlush, 90)
    buffer.push('turn-1', 'a')
    buffer.push('turn-1', 'b')
    vi.advanceTimersByTime(89)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expect(onFlush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFlush).toHaveBeenCalledWith([{ turnId: 'turn-1', text: 'ab' }])
  })

  it('浏览器中默认间隔仍在下一动画帧冲刷', () => {
    let callback: FrameRequestCallback | null = null
    const requestAnimationFrame = vi.fn((next: FrameRequestCallback) => {
      callback = next
      return 1
    })
    vi.stubGlobal('window', { requestAnimationFrame, cancelAnimationFrame: vi.fn() })
    const onFlush = vi.fn()
    const buffer = createStreamBuffer(onFlush)
    buffer.push('turn-1', 'a')
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(onFlush).not.toHaveBeenCalled()
    ;(callback as FrameRequestCallback | null)?.(0)
    expect(onFlush).toHaveBeenCalledWith([{ turnId: 'turn-1', text: 'a' }])
  })
})
