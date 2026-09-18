import { describe, expect, it, vi } from 'vitest'
import type { LocalModelSummary } from '../shared/types'
import { subscribeLocalModels } from './local-model-sync'

function deferred() {
  let resolve!: (models: LocalModelSummary[]) => void
  let reject!: (error: Error) => void
  const promise = new Promise<LocalModelSummary[]>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('本地模型目录同步', () => {
  it('首个请求被变更刷新替代时，等最新目录就绪后才允许恢复模型偏好', async () => {
    const first = deferred()
    const second = deferred()
    let changed!: () => void
    const ready = vi.fn()
    const sync = subscribeLocalModels({ localList: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise), onChanged: (listener) => { changed = listener; return () => {} } }, vi.fn(), vi.fn())
    void sync.ready.then(ready)
    changed()
    first.resolve([])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ready).not.toHaveBeenCalled()
    second.resolve([{ id: -2 }] as LocalModelSummary[])
    await sync.ready
    expect(ready).toHaveBeenCalledOnce()
    sync.dispose()
  })

  it('订阅后立即加载，目录变化独立刷新且旧结果不能覆盖新结果', async () => {
    const first = deferred()
    const second = deferred()
    let changed!: () => void
    const receive = vi.fn()
    const off = vi.fn()
    const sync = subscribeLocalModels({ localList: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise), onChanged: (listener) => { changed = listener; return off } }, receive, vi.fn())
    changed()
    const latest = [{ id: -2, connectionName: '重命名后的服务' }] as LocalModelSummary[]
    second.resolve(latest)
    await second.promise
    first.resolve([{ id: -1 }] as LocalModelSummary[])
    await sync.ready
    expect(receive).toHaveBeenCalledExactlyOnceWith(latest)
    sync.dispose()
    expect(off).toHaveBeenCalledOnce()
  })

  it('卸载后不写状态，刷新失败保留之前的目录并报告失败', async () => {
    const pending = deferred()
    let changed!: () => void
    const receive = vi.fn()
    const failed = vi.fn()
    const models = [{ id: -1 }] as LocalModelSummary[]
    const sync = subscribeLocalModels({ localList: vi.fn().mockResolvedValueOnce(models).mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(pending.promise), onChanged: (listener) => { changed = listener; return () => {} } }, receive, failed)
    await sync.ready
    changed()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(failed).toHaveBeenCalledOnce()
    expect(receive).toHaveBeenCalledExactlyOnceWith(models)
    changed()
    sync.dispose()
    pending.resolve([])
    await pending.promise
    expect(receive).toHaveBeenCalledTimes(1)
  })
})
