import { describe, expect, it } from 'vitest'
import { WorkspaceGate } from './workspace-gate'

/** 可手动结束的任务：记录进入与退出顺序。 */
function deferredTask(log: string[], name: string) {
  let finish!: () => void
  const done = new Promise<void>((resolve) => { finish = resolve })
  const fn = async () => { log.push(`${name}:start`); await done; log.push(`${name}:end`) }
  return { fn, finish }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const target = (path: string) => ({ path, absolutePath: `/repo/${path}` })

describe('WorkspaceGate', () => {
  it('可写子代理之间并行进入', async () => {
    const gate = new WorkspaceGate()
    const log: string[] = []
    const a = deferredTask(log, 'a')
    const b = deferredTask(log, 'b')
    const pa = gate.runWriter(a.fn)
    const pb = gate.runWriter(b.fn)
    await tick()
    expect(log).toEqual(['a:start', 'b:start'])
    a.finish(); b.finish()
    await Promise.all([pa, pb])
  })

  it('可写子代理等同批主 Agent 的写操作结束', async () => {
    const gate = new WorkspaceGate()
    const log: string[] = []
    gate.markMainWrite('edit-1')
    const writer = deferredTask(log, 'writer')
    const pw = gate.runWriter(writer.fn)
    await tick()
    expect(log).toEqual([])
    gate.releaseMainWrite('edit-1')
    gate.releaseMainWrite('edit-1')
    await tick()
    expect(log).toEqual(['writer:start'])
    writer.finish()
    await pw
  })

  it('等待中取消会退出等待，不再执行', async () => {
    const gate = new WorkspaceGate()
    const log: string[] = []
    gate.markMainWrite('edit-1')
    const controller = new AbortController()
    const cancelled = gate.runWriter(async () => { log.push('never') }, controller.signal)
    controller.abort()
    await expect(cancelled).rejects.toThrow('已取消')
    gate.releaseMainWrite('edit-1')
    await tick()
    expect(log).toEqual([])
  })

  it('同一文件只归第一个写入的子代理，同一认领者可重入', async () => {
    const gate = new WorkspaceGate()
    let release!: () => void
    const running = gate.runWriter(() => new Promise<void>((resolve) => { release = resolve }))
    await tick()
    expect(gate.claimFiles('t1', 'builder：写 a', [target('a.md')])).toBeNull()
    expect(gate.claimFiles('t1', 'builder：写 a', [target('a.md')])).toBeNull()
    expect(gate.claimFiles('t2', 'builder：写 b', [target('b.md')])).toBeNull()
    expect(gate.claimFiles('t2', 'builder：写 b', [target('c.md'), target('a.md')])).toEqual({ path: 'a.md', ownerLabel: 'builder：写 a' })
    // 冲突时整批不认领：c.md 仍然空闲
    expect(gate.claimFiles('t3', 'builder：写 c', [target('c.md')])).toBeNull()
    release()
    await running
  })

  it('认领保留到所有可写子代理结束：先结束的子代理的文件不能被还在跑的覆盖', async () => {
    const gate = new WorkspaceGate()
    let releaseA!: () => void
    let releaseB!: () => void
    const a = gate.runWriter(async () => {
      gate.claimFiles('a', 'builder：a', [target('shared.ts')])
      await new Promise<void>((resolve) => { releaseA = resolve })
    })
    const b = gate.runWriter(() => new Promise<void>((resolve) => { releaseB = resolve }))
    await tick()
    releaseA()
    await a
    expect(gate.claimFiles('b', 'builder：b', [target('shared.ts')])).not.toBeNull()
    releaseB()
    await b
    // 全部结束后认领清空，下一批重新开始
    expect(gate.claimFiles('c', 'builder：c', [target('shared.ts')])).toBeNull()
  })

  it.runIf(process.platform === 'win32')('Windows 上大小写不同的同一路径算同一文件', () => {
    const gate = new WorkspaceGate()
    gate.claimFiles('a', 'builder：a', [{ path: 'A.md', absolutePath: 'K:\\repo\\A.md' }])
    expect(gate.claimFiles('b', 'builder：b', [{ path: 'a.md', absolutePath: 'k:/repo/a.md' }])).not.toBeNull()
  })

  it('任务抛错也会释放计数', async () => {
    const gate = new WorkspaceGate()
    await expect(gate.runWriter(async () => {
      gate.claimFiles('a', 'builder：a', [target('x.ts')])
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect(gate.claimFiles('b', 'builder：b', [target('x.ts')])).toBeNull()
  })
})
