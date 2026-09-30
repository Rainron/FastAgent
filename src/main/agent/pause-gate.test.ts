import { describe, expect, it, vi } from 'vitest'
import { PauseGate } from './pause-gate'

describe('PauseGate', () => {
  it('未暂停时同步放行，不产生 Promise', () => {
    const gate = new PauseGate()
    expect(gate.wait()).toBeUndefined()
    expect(gate.isPaused).toBe(false)
  })

  it('暂停后阻塞，恢复时一次性放行全部等待者', async () => {
    const gate = new PauseGate()
    gate.pause()
    const released: number[] = []
    const first = Promise.resolve(gate.wait()).then(() => released.push(1))
    const second = Promise.resolve(gate.wait()).then(() => released.push(2))
    await Promise.resolve()
    expect(released).toEqual([])
    expect(gate.waitingCount).toBe(2)

    gate.resume()
    await Promise.all([first, second])
    expect(released).toEqual([1, 2])
    expect(gate.waitingCount).toBe(0)
  })

  it('取消优先于暂停：signal 中止时立刻放行，否则连取消都点不动', async () => {
    const gate = new PauseGate()
    gate.pause()
    const controller = new AbortController()
    let done = false
    const waiting = Promise.resolve(gate.wait(controller.signal)).then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)

    controller.abort()
    await waiting
    expect(done).toBe(true)
    // 仍处于暂停态，但等待队列已经清空，不会在恢复时被重复放行
    expect(gate.isPaused).toBe(true)
    expect(gate.waitingCount).toBe(0)
  })

  it('已中止的 signal 直接放行，不进队列', () => {
    const gate = new PauseGate()
    gate.pause()
    const controller = new AbortController()
    controller.abort()
    expect(gate.wait(controller.signal)).toBeUndefined()
    expect(gate.waitingCount).toBe(0)
  })

  it('重复 resume 不报错，也不重复释放', async () => {
    const gate = new PauseGate()
    const release = vi.fn()
    gate.pause()
    void Promise.resolve(gate.wait()).then(release)
    gate.resume()
    gate.resume()
    await Promise.resolve()
    expect(release).toHaveBeenCalledTimes(1)
  })
})
