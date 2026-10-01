import { describe, expect, it, vi } from 'vitest'
import { compactIfOverThreshold, readOverThreshold, shouldCompactAfterRun } from './compaction-trigger'
import type { AgentEvent, ContextPolicy, ModelCredentials } from '../../shared/types'
import type { ContextMeasurement } from '../context-meter'
import type { RunContext } from './context'

function policy(patch: Partial<ContextPolicy> = {}): ContextPolicy {
  return { conversationId: 'c1', strategy: 'auto', autoSummary: true, triggerRatio: null, keepRecentTurns: null, forceCompaction: false, inheritGlobal: true, ...patch }
}

function input(patch: Partial<Parameters<typeof shouldCompactAfterRun>[0]> = {}) {
  return { policy: policy(), estimatedTokens: 100_000, contextWindow: 128_000, runtimeCompacted: false, compactionInFlight: false, ...patch }
}

describe('shouldCompactAfterRun', () => {
  it('越过档位触发点就补一次压缩', () => {
    // 均衡档 78%：触发点 128000 - reserve 28160 = 99840，本轮 100000 已越线
    expect(shouldCompactAfterRun(input())).toMatchObject({ compact: true, triggerTokens: 99_840 })
  })

  it('判定口径与 Pi 一致：等于触发点不压，多一个 token 才压', () => {
    // Pi 的判定是严格大于（tokens > contextWindow - reserveTokens），这里不能用 >=，
    // 否则同一份测量会出现「Pi 不压、桌面压」的来回抖动。
    expect(shouldCompactAfterRun(input({ estimatedTokens: 99_840 }))).toEqual({ compact: false, reason: 'below-threshold' })
    expect(shouldCompactAfterRun(input({ estimatedTokens: 99_841 }))).toMatchObject({ compact: true })
  })

  it('低于可设区间下沿的触发点基本如实生效', () => {
    // 触发 30%：收敛约束只把它抬到 30.6%（392192），偏差不到 1 个百分点，界面也不会报 clamped
    const low = policy({ triggerRatio: 0.3 })
    expect(shouldCompactAfterRun(input({ policy: low, estimatedTokens: 392_192, contextWindow: 1_280_000 }))).toEqual({ compact: false, reason: 'below-threshold' })
    expect(shouldCompactAfterRun(input({ policy: low, estimatedTokens: 392_193, contextWindow: 1_280_000 }))).toMatchObject({ compact: true, triggerTokens: 392_192 })
  })

  it('未越线时不压', () => {
    expect(shouldCompactAfterRun(input({ estimatedTokens: 90_000 }))).toEqual({ compact: false, reason: 'below-threshold' })
  })

  it('关闭档与旧的 autoSummary=false 都不触发', () => {
    expect(shouldCompactAfterRun(input({ policy: policy({ strategy: 'disabled' }) }))).toEqual({ compact: false, reason: 'disabled' })
    expect(shouldCompactAfterRun(input({ policy: policy({ autoSummary: false }) }))).toEqual({ compact: false, reason: 'disabled' })
  })

  it('会话级显式阈值优先于档位', () => {
    expect(shouldCompactAfterRun(input({ policy: policy({ triggerRatio: 0.9 }) }))).toEqual({ compact: false, reason: 'below-threshold' })
    expect(shouldCompactAfterRun(input({ estimatedTokens: 70_000, policy: policy({ triggerRatio: 0.5 }) }))).toMatchObject({ compact: true })
  })

  it('Pi 本轮已经压过就不再叠加', () => {
    expect(shouldCompactAfterRun(input({ runtimeCompacted: true }))).toEqual({ compact: false, reason: 'already-compacted' })
  })

  it('已有压缩在跑时不重入', () => {
    expect(shouldCompactAfterRun(input({ compactionInFlight: true }))).toEqual({ compact: false, reason: 'in-flight' })
  })

  it('窗口或用量未知时不猜，宁可不压', () => {
    expect(shouldCompactAfterRun(input({ contextWindow: 0 }))).toEqual({ compact: false, reason: 'unknown-window' })
    expect(shouldCompactAfterRun(input({ estimatedTokens: 0 }))).toEqual({ compact: false, reason: 'unknown-window' })
    expect(shouldCompactAfterRun(input({ estimatedTokens: Number.NaN }))).toEqual({ compact: false, reason: 'unknown-window' })
  })
})

function measurement(patch: Partial<ContextMeasurement> = {}): ContextMeasurement {
  return {
    modelId: 1, provider: 'openai', contextWindow: 128_000, estimatedTokens: 100_000,
    systemTokens: 0, messageTokens: 100_000, toolTokens: 0, attachmentTokens: 0, summaryTokens: 0,
    countingMethod: 'provider-usage', ...patch
  }
}

/** 编排测试只关心这三样：谁被调用、返回什么、发了哪些事件。 */
function harness(options: {
  compactResult?: unknown
  forceResult?: unknown
  compactError?: Error
} = {}) {
  const events: Array<Omit<AgentEvent, 'runId'>> = []
  const compactConversation = vi.fn(async () => {
    if (options.compactError) throw options.compactError
    return (options.compactResult ?? null) as never
  })
  const forceCompactConversation = vi.fn(async () => (options.forceResult ?? null) as never)
  const ctx = { activeCompactions: new Map(), compactConversation, forceCompactConversation } as unknown as RunContext
  return {
    ctx, events, compactConversation, forceCompactConversation,
    run: (policyPatch: Partial<ContextPolicy>, measurementPatch: Partial<ContextMeasurement> = {}, runtimeCompacted = false) =>
      compactIfOverThreshold({
        ctx,
        namespace: 'ns',
        conversationId: 'c1',
        policy: policy(policyPatch),
        credentials: { id: 1, max_tokens: 8_192 } as unknown as ModelCredentials,
        measurement: measurement(measurementPatch),
        runtimeCompacted,
        emit: (event) => { events.push(event) }
      }),
    details: () => events.map((event) => event.detail ?? '')
  }
}

const compacted = { context: { conversationId: 'c1' }, compaction: { id: 'x' } }

describe('readOverThreshold', () => {
  it('口径与 shouldCompactAfterRun 同一份换算', () => {
    expect(readOverThreshold(policy(), measurement({ estimatedTokens: 99_840 }))).toMatchObject({ over: false, triggerTokens: 99_840 })
    expect(readOverThreshold(policy(), measurement({ estimatedTokens: 99_841 }))).toMatchObject({ over: true })
  })

  it('窗口或用量未知时不判越线', () => {
    expect(readOverThreshold(policy(), undefined).over).toBe(false)
    expect(readOverThreshold(policy(), measurement({ contextWindow: 0 })).over).toBe(false)
  })
})

describe('compactIfOverThreshold 强制压缩降级', () => {
  it('常规压缩压下去了就不动强压', async () => {
    const h = harness({ compactResult: compacted })
    await expect(h.run({ forceCompaction: true })).resolves.toEqual({ compacted: true })
    expect(h.forceCompactConversation).not.toHaveBeenCalled()
  })

  it('压不动且没开强压：只提示，并指路到那个开关', async () => {
    const h = harness()
    await expect(h.run({ forceCompaction: false })).resolves.toEqual({ compacted: false })
    expect(h.forceCompactConversation).not.toHaveBeenCalled()
    expect(h.details().join('')).toContain('强制压缩')
  })

  it('压不动且开了强压：降级到强压并报成功', async () => {
    const h = harness({ forceResult: compacted })
    await expect(h.run({ forceCompaction: true })).resolves.toEqual({ compacted: true })
    expect(h.forceCompactConversation).toHaveBeenCalledWith('ns', 'c1', expect.anything())
    expect(h.events.some((event) => event.type === 'compactionCompleted')).toBe(true)
  })

  it('强压也压不动时说清已经没有退路', async () => {
    const h = harness()
    await expect(h.run({ forceCompaction: true })).resolves.toEqual({ compacted: false })
    expect(h.details().join('')).toContain('强制压缩也没有可压缩内容')
  })

  it('Pi 本轮压过但仍在红线上：开了强压就直接强压，不再走常规那一刀', async () => {
    const h = harness({ forceResult: compacted })
    await expect(h.run({ forceCompaction: true }, {}, true)).resolves.toEqual({ compacted: true })
    expect(h.compactConversation).not.toHaveBeenCalled()
    expect(h.forceCompactConversation).toHaveBeenCalledOnce()
  })

  it('Pi 本轮压过且已回到阈值以下：什么都不做', async () => {
    const h = harness({ forceResult: compacted })
    await expect(h.run({ forceCompaction: true }, { estimatedTokens: 50_000 }, true)).resolves.toEqual({ compacted: false })
    expect(h.forceCompactConversation).not.toHaveBeenCalled()
    expect(h.events).toHaveLength(0)
  })

  it('把触发阈值调低就能在更低水位上触发整条链路', async () => {
    // 默认档 78%（99840）不触发 60000；调到 30% 后触发点落到 38400，同一份用量立刻越线
    const quiet = harness({ forceResult: compacted })
    await expect(quiet.run({ forceCompaction: true }, { estimatedTokens: 60_000 })).resolves.toEqual({ compacted: false })
    expect(quiet.compactConversation).not.toHaveBeenCalled()

    const loud = harness({ forceResult: compacted })
    await expect(loud.run({ forceCompaction: true, triggerRatio: 0.3 }, { estimatedTokens: 60_000 })).resolves.toEqual({ compacted: true })
    expect(loud.compactConversation).toHaveBeenCalledOnce()
    expect(loud.forceCompactConversation).toHaveBeenCalledOnce()
  })

  it('压缩调用抛错不把这一轮变成失败，只留提示', async () => {
    const h = harness({ compactError: new Error('模型不可用') })
    await expect(h.run({ forceCompaction: true })).resolves.toEqual({ compacted: false })
    expect(h.details().join('')).toContain('模型不可用')
  })
})
