import { describe, expect, it, vi } from 'vitest'
import { restartApplication } from './app-restart'

describe('restartApplication', () => {
  it('确认后按正常退出流程重启，避免直接 exit 绕过清理', async () => {
    const calls: string[] = []
    const result = await restartApplication({
      confirm: async () => true,
      stop: () => calls.push('stop'),
      markQuitting: () => calls.push('mark-quitting'),
      relaunch: () => calls.push('relaunch'),
      quit: () => calls.push('quit')
    })

    expect(result).toBe(true)
    expect(calls).toEqual(['stop', 'mark-quitting', 'relaunch', 'quit'])
  })

  it('取消确认时不执行退出或重启', async () => {
    const stop = vi.fn()
    const markQuitting = vi.fn()
    const relaunch = vi.fn()
    const quit = vi.fn()

    const result = await restartApplication({
      confirm: async () => false,
      stop,
      markQuitting,
      relaunch,
      quit
    })

    expect(result).toBe(false)
    expect(stop).not.toHaveBeenCalled()
    expect(markQuitting).not.toHaveBeenCalled()
    expect(relaunch).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })
})
