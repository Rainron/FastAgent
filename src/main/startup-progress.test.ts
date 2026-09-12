import { describe, expect, it, vi } from 'vitest'
import {
  createRevealCoordinator,
  SPLASH_SLOW_DELAY_MS,
  SPLASH_STATUS_DELAY_MS,
  splashUpdate,
  splashVerbosity,
  STARTUP_PHASE_LABELS,
  type RevealReason
} from './startup-progress'

describe('splashVerbosity', () => {
  it('启动够快时不露阶段文字', () => {
    expect(splashVerbosity(0)).toBe('minimal')
    expect(splashVerbosity(SPLASH_STATUS_DELAY_MS - 1)).toBe('minimal')
  })

  it('到 1.2 秒开始给真实状态', () => {
    expect(splashVerbosity(SPLASH_STATUS_DELAY_MS)).toBe('status')
    expect(splashVerbosity(SPLASH_SLOW_DELAY_MS - 1)).toBe('status')
  })

  it('到 5 秒升级为耗时提示', () => {
    expect(splashVerbosity(SPLASH_SLOW_DELAY_MS)).toBe('slow')
    expect(splashVerbosity(30_000)).toBe('slow')
  })
})

describe('splashUpdate', () => {
  it('按阶段取文案并带上当前档位', () => {
    expect(splashUpdate('workspace', 2000)).toEqual({
      phase: 'workspace',
      label: STARTUP_PHASE_LABELS.workspace,
      verbosity: 'status'
    })
  })

  it('阶段文案不包含启动期不存在的 Agent 初始化', () => {
    const labels = Object.values(STARTUP_PHASE_LABELS)
    expect(labels.some((label) => label.includes('Agent'))).toBe(false)
  })
})

/** 用假定时器把 cap 摆到可控位置，避免测试依赖真实等待。 */
function coordinatorHarness(capMs = 2500) {
  const reasons: RevealReason[] = []
  let pending: (() => void) | null = null
  const coordinator = createRevealCoordinator({
    capMs,
    onReveal: (reason) => reasons.push(reason),
    setTimer: (handler) => { pending = handler; return 1 },
    clearTimer: () => { pending = null }
  })
  return { coordinator, reasons, fireCap: () => { const handler = pending; pending = null; handler?.() }, hasCap: () => pending !== null }
}

describe('createRevealCoordinator', () => {
  it('首帧与首屏数据都就绪才按 ready 显示', () => {
    const { coordinator, reasons } = coordinatorHarness()
    coordinator.markRendererReady()
    expect(reasons).toEqual([])
    coordinator.markWindowReady()
    expect(reasons).toEqual(['ready'])
  })

  it('首帧先到时等首屏数据，数据到了立即显示并撤掉 cap', () => {
    const { coordinator, reasons, hasCap } = coordinatorHarness()
    coordinator.markWindowReady()
    expect(hasCap()).toBe(true)
    coordinator.markRendererReady()
    expect(reasons).toEqual(['ready'])
    expect(hasCap()).toBe(false)
  })

  it('首屏数据迟迟不来时由 cap 放行', () => {
    const { coordinator, reasons, fireCap } = coordinatorHarness()
    coordinator.markWindowReady()
    fireCap()
    expect(reasons).toEqual(['cap'])
  })

  it('cap 放行后迟到的首屏就绪不会再显示第二次', () => {
    const { coordinator, reasons, fireCap } = coordinatorHarness()
    coordinator.markWindowReady()
    fireCap()
    coordinator.markRendererReady()
    expect(reasons).toEqual(['cap'])
  })

  it('异常兜底可以抢在首帧之前放行，且只放行一次', () => {
    const { coordinator, reasons } = coordinatorHarness()
    coordinator.forceReveal('fallback')
    coordinator.markWindowReady()
    coordinator.markRendererReady()
    coordinator.forceReveal('fallback')
    expect(reasons).toEqual(['fallback'])
  })

  it('重复的首帧通知不会重复挂 cap 定时器', () => {
    const setTimer = vi.fn(() => 1)
    const coordinator = createRevealCoordinator({ capMs: 2500, onReveal: () => undefined, setTimer, clearTimer: () => undefined })
    coordinator.markWindowReady()
    coordinator.markWindowReady()
    expect(setTimer).toHaveBeenCalledTimes(1)
  })

  it('dispose 后 cap 不再触发显示', () => {
    const { coordinator, reasons, fireCap, hasCap } = coordinatorHarness()
    coordinator.markWindowReady()
    coordinator.dispose()
    expect(hasCap()).toBe(false)
    fireCap()
    expect(reasons).toEqual([])
  })
})
