import { describe, expect, it } from 'vitest'
import {
  INITIAL_CONVERGENCE_STATE,
  MAX_COMPACTIONS_PER_RUN,
  convergenceStalledDetail,
  trackCompactionConvergence,
  type CompactionAttempt,
  type ConvergenceState
} from './compaction-convergence'

const TRIGGER = 20_025

/** 顺序喂一串压缩结果，返回第一次判定停手的下标（从 0 数）与原因。 */
function firstStop(series: CompactionAttempt[], triggerTokens = TRIGGER) {
  let state: ConvergenceState = INITIAL_CONVERGENCE_STATE
  for (const [index, attempt] of series.entries()) {
    const verdict = trackCompactionConvergence(state, attempt, triggerTokens)
    state = verdict.state
    if (verdict.stalled) return { index, reason: verdict.reason, total: state.total }
  }
  return null
}

describe('trackCompactionConvergence', () => {
  it('压到触发点以下就不算 stalled，连续计数清零', () => {
    const verdict = trackCompactionConvergence(INITIAL_CONVERGENCE_STATE, { tokensBefore: 29_219, tokensAfter: 17_944 }, TRIGGER)
    expect(verdict).toMatchObject({ stalled: false })
    expect(verdict.state).toMatchObject({ consecutiveStalled: 0, total: 1 })
  })

  it('压完反而没变小时一次就停', () => {
    expect(trackCompactionConvergence(INITIAL_CONVERGENCE_STATE, { tokensBefore: 18_000, tokensAfter: 18_000 }, TRIGGER))
      .toMatchObject({ stalled: true, reason: 'no-progress' })
    expect(trackCompactionConvergence(INITIAL_CONVERGENCE_STATE, { tokensBefore: 18_000, tokensAfter: 19_000 }, TRIGGER))
      .toMatchObject({ stalled: true, reason: 'no-progress' })
  })

  it('连续两次压完仍在触发点之上就停', () => {
    const stop = firstStop([
      { tokensBefore: 30_000, tokensAfter: 25_000 },
      { tokensBefore: 31_000, tokensAfter: 24_000 }
    ])
    expect(stop).toMatchObject({ index: 1, reason: 'still-over-threshold' })
  })

  it('中间压到线下一次就重新计数，不会被误杀', () => {
    const stop = firstStop([
      { tokensBefore: 30_000, tokensAfter: 25_000 },
      { tokensBefore: 29_000, tokensAfter: 12_000 },
      { tokensBefore: 30_000, tokensAfter: 25_000 }
    ])
    expect(stop).toBeNull()
  })

  /** 这一条是真机实测的形状：次次压到线下，但落点离触发点只有 2k，压缩在空转。 */
  it('次次压缩都「成功」却在空转时，按次数上限停手', () => {
    const thrash: CompactionAttempt[] = [
      { tokensBefore: 29_219, tokensAfter: 17_944 },
      { tokensBefore: 25_808, tokensAfter: 18_236 },
      { tokensBefore: 26_217, tokensAfter: 17_469 },
      { tokensBefore: 26_143, tokensAfter: 17_479 },
      { tokensBefore: 26_806, tokensAfter: 17_956 },
      { tokensBefore: 25_796, tokensAfter: 17_121 }
    ]
    const stop = firstStop(thrash)
    expect(stop).toMatchObject({ reason: 'thrashing', total: MAX_COMPACTIONS_PER_RUN })
    // 真机跑成了 22 次，加保护后第 5 次就该停
    expect(stop!.index).toBe(MAX_COMPACTIONS_PER_RUN - 1)
  })

  it('次数上限与窗口是否已知无关：空转就是空转', () => {
    const series = Array.from({ length: 6 }, () => ({ tokensBefore: 0, tokensAfter: 0 }))
    expect(firstStop(series, 0)).toMatchObject({ reason: 'thrashing' })
  })

  it('测量值缺失时不判「压没压下去」，只靠次数兜底', () => {
    const verdict = trackCompactionConvergence(INITIAL_CONVERGENCE_STATE, { tokensBefore: 20_000, tokensAfter: Number.NaN }, TRIGGER)
    expect(verdict).toMatchObject({ stalled: false })
    expect(verdict.state.consecutiveStalled).toBe(0)
  })

  it('健康配置下压两三次不会被停', () => {
    const healthy: CompactionAttempt[] = [
      { tokensBefore: 800_000, tokensAfter: 300_000 },
      { tokensBefore: 810_000, tokensAfter: 305_000 },
      { tokensBefore: 820_000, tokensAfter: 310_000 }
    ]
    expect(firstStop(healthy, 838_861)).toBeNull()
  })

  it('上限可调，便于在调用处按场景收紧', () => {
    const state = trackCompactionConvergence(INITIAL_CONVERGENCE_STATE, { tokensBefore: 30_000, tokensAfter: 10_000 }, TRIGGER, { maxPerRun: 1 })
    expect(state).toMatchObject({ stalled: true, reason: 'thrashing' })
  })
})

describe('convergenceStalledDetail', () => {
  it('三种原因各给各的下一步，都带上当前占比', () => {
    expect(convergenceStalledDetail('no-progress', 0.52, 1)).toContain('没能减少上下文')
    expect(convergenceStalledDetail('still-over-threshold', 0.52, 2)).toContain('连续压缩')
    const thrashing = convergenceStalledDetail('thrashing', 0.52, 5)
    expect(thrashing).toContain('已自动压缩 5 次')
    expect(thrashing).toContain('调高触发阈值')
    for (const reason of ['no-progress', 'still-over-threshold', 'thrashing'] as const) {
      expect(convergenceStalledDetail(reason, 0.52, 5)).toContain('52%')
      expect(convergenceStalledDetail(reason, 0.52, 5)).toContain('开新会话')
    }
  })
})
