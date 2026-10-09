import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** 假的 utilityProcess 子进程：kill 之后异步发 exit，和真实进程一样晚于调用方的后续操作。 */
class FakeChild extends EventEmitter {
  posted: unknown[] = []
  killed = false
  postMessage(message: unknown) {
    this.posted.push(message)
    const request = message as { kind: string; id: number }
    if (request.kind === 'mount') setTimeout(() => this.emit('message', { kind: 'mounted', id: request.id, activations: {} }), 1)
  }
  kill() {
    this.killed = true
    setTimeout(() => this.emit('exit', 1), 5)
    return true
  }
}

const children: FakeChild[] = []
vi.mock('electron', () => ({
  utilityProcess: {
    fork: () => {
      const child = new FakeChild()
      children.push(child)
      // 宿主起来后先发 ready
      setTimeout(() => child.emit('message', { kind: 'ready' }), 1)
      return child
    }
  }
}))

const { DshHostClient } = await import('./host-client')

describe('DshHostClient 进程切换', () => {
  beforeEach(() => { children.length = 0 })
  const root = mkdtempSync(join(tmpdir(), 'dsh-host-client-'))

  it('旧进程被 stop 后迟到的 exit 不会清掉新进程，也不算崩溃', async () => {
    const onCrash = vi.fn()
    const client = new DshHostClient({ root: () => root, entryPath: 'host.js', onCrash })
    await client.mount([])
    client.stop()
    const second = client.mount([])
    await expect(second).resolves.toEqual({})
    // 等旧进程的 exit 到达之后，新进程必须仍在
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(client.running).toBe(true)
    await expect(client.mount([])).resolves.toEqual({})
    expect(onCrash).not.toHaveBeenCalled()
    expect(children[1].killed).toBe(false)
  })

  it('进程在请求发出前被停掉时，请求以明确错误失败而不是空指针', async () => {
    const client = new DshHostClient({ root: () => root, entryPath: 'host.js' })
    const pending = client.mount([])
    client.stop()
    await expect(pending).rejects.toThrow(/已停止|退出/)
  })
})
