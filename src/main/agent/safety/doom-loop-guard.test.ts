import { describe, expect, it } from 'vitest'
import { DoomLoopGuard } from './doom-loop-guard'

describe('doom loop guard', () => {
  it('同 hash 连续第 3 次触发', () => {
    const guard = new DoomLoopGuard()
    const first = guard.check('bash', { command: 'failing-command' })
    const second = guard.check('bash', { command: 'failing-command' })
    const third = guard.check('bash', { command: 'failing-command' })
    expect(first.triggered).toBe(false)
    expect(second.triggered).toBe(false)
    expect(third.triggered).toBe(true)
    expect(first.hash).toBe(second.hash)
    expect(third.hash).toBe(first.hash)
  })

  it('触发后重新计数，插入其它命令不打断本 hash 的连续计数', () => {
    const guard = new DoomLoopGuard()
    guard.check('bash', { command: 'a' })
    guard.check('bash', { command: 'a' })
    expect(guard.check('bash', { command: 'a' }).triggered).toBe(true)
    // 触发后重置：再次连续两次不触发
    expect(guard.check('bash', { command: 'a' }).triggered).toBe(false)
    expect(guard.check('bash', { command: 'a' }).triggered).toBe(false)
    // 其它命令只对自己的计数负责
    guard.check('bash', { command: 'b' })
    expect(guard.check('bash', { command: 'a' }).triggered).toBe(true)
  })

  it('不同入参（键序无关）hash 不同，同入参 hash 相同', () => {
    const guard = new DoomLoopGuard()
    const left = guard.hash('edit', { path: 'a.ts', edits: [{ oldText: 'x', newText: 'y' }] })
    const right = guard.hash('edit', { edits: [{ newText: 'y', oldText: 'x' }], path: 'a.ts' })
    expect(left).toBe(right)
    expect(left).not.toBe(guard.hash('edit', { path: 'b.ts', edits: [{ oldText: 'x', newText: 'y' }] }))
  })

  it('豁免的 hash 不再计数与触发', () => {
    const guard = new DoomLoopGuard()
    const hash = guard.check('bash', { command: 'repeat' }).hash
    guard.exemptHash(hash)
    expect(guard.check('bash', { command: 'repeat' }).triggered).toBe(false)
    expect(guard.check('bash', { command: 'repeat' }).triggered).toBe(false)
    expect(guard.check('bash', { command: 'repeat' }).triggered).toBe(false)
  })

  it('不同工具同名参数不算重复', () => {
    const guard = new DoomLoopGuard()
    guard.check('bash', { command: 'x' })
    guard.check('bash', { command: 'x' })
    expect(guard.check('read', { path: 'x' }).triggered).toBe(false)
  })
})