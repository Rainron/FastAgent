import { describe, expect, it, vi } from 'vitest'
import { whenFirstScreenReady, type ReadyTimer } from './startup-ready'

/** 手动持有超时回调，测试里自己决定「上限到了」发生在哪一刻。 */
function manualTimer() {
  let pending: (() => void) | null = null
  const timer: ReadyTimer = {
    set: (handler) => { pending = handler; return 1 },
    clear: () => { pending = null }
  }
  return { timer, fire: () => { const handler = pending; pending = null; handler?.() }, pendingCount: () => (pending ? 1 : 0) }
}

describe('whenFirstScreenReady', () => {
  it('全部完成后解析并撤掉超时定时器', async () => {
    const { timer, pendingCount } = manualTimer()
    await whenFirstScreenReady([Promise.resolve(1), Promise.resolve(2)], 2500, timer)
    expect(pendingCount()).toBe(0)
  })

  it('单路失败不影响整体就绪', async () => {
    const { timer } = manualTimer()
    await expect(whenFirstScreenReady([Promise.resolve(1), Promise.reject(new Error('列表加载失败'))], 2500, timer)).resolves.toBeUndefined()
  })

  it('有路悬挂时由上限放行', async () => {
    const { timer, fire } = manualTimer()
    const ready = whenFirstScreenReady([new Promise(() => undefined)], 2500, timer)
    fire()
    await expect(ready).resolves.toBeUndefined()
  })

  it('上限放行后迟到的数据不会二次解析', async () => {
    const { timer, fire } = manualTimer()
    let resolveLate = () => undefined as void
    const late = new Promise<void>((resolve) => { resolveLate = resolve })
    const settled = vi.fn()
    void whenFirstScreenReady([late], 2500, timer).then(settled)
    fire()
    await Promise.resolve()
    resolveLate()
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('空列表立即就绪', async () => {
    const { timer, pendingCount } = manualTimer()
    await whenFirstScreenReady([], 2500, timer)
    expect(pendingCount()).toBe(0)
  })
})
