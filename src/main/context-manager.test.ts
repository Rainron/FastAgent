import { describe, expect, it } from 'vitest'
import { buildSummarySourceText, contextTargetRatio, heuristicSummary, piCompactionSettings, projectCompactedState, resolvePolicy, splitTurns, targetRatioFor, triggerRatioFor } from './context-manager'
import * as contextManager from './context-manager'
import type { AppSettings, ContextPolicy, ContextState, ConversationTurn } from '../shared/types'
import { defaultSandboxSettings } from '../shared/sandbox'
import { DEFAULT_ATTACHMENT_POLICY } from '../shared/attachment-policy'
import { DEFAULT_RUN_LIMITS } from './local-store/row-mappers'

const settings: AppSettings = {
  ...DEFAULT_ATTACHMENT_POLICY,
  motionPreference: 'system',
  startAtLogin: false,
  showOnStartup: true,
  closeToTray: true,
  theme: 'system',
  autoSummary: true,
  contextStrategy: 'disabled',
  triggerRatio: null,
  targetRatio: null,
  keepRecentTurns: null,
  shellPreference: 'bash',
  bashPath: '',
  externalEditorPath: '',
  agentAbilityPolicy: { mode: 'all_enabled', agentAbilityIds: [] },
  subAgentEnabled: true,
  memory: { enabled: true, autoExtract: true, maxRecall: 5, extractModelId: null },
  sandbox: defaultSandboxSettings,
  quickDialogEnabled: true,
  limits: DEFAULT_RUN_LIMITS,
  accentColor: 'green',
  baseFontSize: 'medium',
  uiDensity: 'comfortable',
  surfaceLevel: 'standard',
  bodyTextContrast: 'standard',
  sidebarGlass: false
}

function turn(id: string, patch: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    id,
    conversationId: 'conversation-1',
    userMessage: { text: `请求 ${id}`, createdAt: '2026-08-30T00:00:00.000Z' },
    attachments: [],
    activity: null,
    assistantMessage: null,
    citations: [],
    artifacts: [],
    runtimeConfig: { modelId: 1, thinkingLevel: 'auto', mode: 'chat', permission: null, project: null },
    status: 'completed',
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...patch
  }
}

function policy(patch: Partial<ContextPolicy> = {}): ContextPolicy {
  return { conversationId: 'conversation-1', strategy: 'auto', autoSummary: true, triggerRatio: null, targetRatio: null, keepRecentTurns: null, inheritGlobal: true, ...patch }
}

describe('resolvePolicy', () => {
  it('maps global contextStrategy onto the policy strategy field', () => {
    expect(resolvePolicy(settings, null, 'conversation-1')).toEqual({
      conversationId: 'conversation-1',
      strategy: 'disabled',
      autoSummary: true,
      triggerRatio: null,
      targetRatio: null,
      keepRecentTurns: null,
      inheritGlobal: true
    })
  })

  it('prefers the stored conversation policy', () => {
    const stored = policy({ strategy: 'aggressive', inheritGlobal: false })
    expect(resolvePolicy(settings, stored, 'conversation-1')).toBe(stored)
  })
})

describe('piCompactionSettings', () => {
  // Pi 的判定是 tokens > contextWindow - reserveTokens，所以 reserveTokens 就是触发占比的补数。
  it('把策略默认阈值换算成 Pi 的 reserveTokens', () => {
    expect(piCompactionSettings(policy({ strategy: 'conservative' }), 128_000)).toEqual({ enabled: true, reserveTokens: 19_200, keepRecentTokens: 67_840 })
    expect(piCompactionSettings(policy({ strategy: 'aggressive' }), 128_000)).toEqual({ enabled: true, reserveTokens: 40_960, keepRecentTokens: 16_640 })
  })

  it('显式 triggerRatio 优先于策略默认值', () => {
    expect(piCompactionSettings(policy({ strategy: 'conservative', triggerRatio: 0.5 }), 128_000).reserveTokens).toBe(64_000)
  })

  it('显式 targetRatio 决定压缩后保留多少原文', () => {
    // 触发点仍是 conservative 的 85%（reserve 19200），保留区按目标 45% 算：57600 - 19200
    expect(piCompactionSettings(policy({ strategy: 'conservative', targetRatio: 0.45 }), 128_000)).toEqual({ enabled: true, reserveTokens: 19_200, keepRecentTokens: 38_400 })
    expect(targetRatioFor(policy({ strategy: 'conservative' }))).toBe(0.68)
    expect(targetRatioFor(policy({ strategy: 'conservative', targetRatio: 0.4 }))).toBe(0.4)
  })

  it('策略关闭或自动摘要关闭时 enabled 为 false', () => {
    expect(piCompactionSettings(policy({ strategy: 'disabled' }), 128_000).enabled).toBe(false)
    expect(piCompactionSettings(policy({ autoSummary: false }), 128_000).enabled).toBe(false)
  })

  it('窗口未知时沿用 Pi 默认值，不做猜测', () => {
    expect(piCompactionSettings(policy(), 0)).toEqual({ enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 })
  })

  it('任何窗口下预留区与保留区之和都不顶穿窗口', () => {
    for (const contextWindow of [8_000, 32_000, 128_000, 200_000, 1_000_000]) {
      for (const strategy of ['auto', 'aggressive', 'conservative'] as const) {
        const result = piCompactionSettings(policy({ strategy }), contextWindow)
        expect(result.reserveTokens + result.keepRecentTokens).toBeLessThan(contextWindow)
        expect(result.keepRecentTokens).toBeGreaterThan(0)
      }
    }
  })
})

describe('triggerRatioFor and contextTargetRatio', () => {
  it('covers all four documented strategies', () => {
    expect(triggerRatioFor(policy({ strategy: 'auto' }))).toBe(0.78)
    expect(triggerRatioFor(policy({ strategy: 'conservative' }))).toBe(0.85)
    expect(triggerRatioFor(policy({ strategy: 'aggressive' }))).toBe(0.68)
    expect(contextTargetRatio('auto')).toBe(0.55)
    expect(contextTargetRatio('conservative')).toBe(0.68)
    expect(contextTargetRatio('aggressive')).toBe(0.45)
    expect(contextTargetRatio('disabled')).toBe(1)
  })
})

describe('splitTurns', () => {
  it('keeps everything when the history is shorter than the keep window', () => {
    const turns = [turn('a'), turn('b')]
    expect(splitTurns(turns, null)).toEqual({ compressible: [], kept: turns })
  })

  it('compresses the oldest turns beyond the keep window', () => {
    const turns = ['a', 'b', 'c', 'd', 'e'].map((id) => turn(id))
    const result = splitTurns(turns, 2)
    expect(result.compressible.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(result.kept.map((item) => item.id)).toEqual(['d', 'e'])
  })

  it('clamps the keep window to a minimum of two turns', () => {
    const turns = ['a', 'b', 'c'].map((id) => turn(id))
    expect(splitTurns(turns, 0).kept.map((item) => item.id)).toEqual(['b', 'c'])
  })
})

describe('摘要覆盖范围', () => {
  it('只返回 coveredTurnEnd 之后的有效回合', () => {
    const turns = ['a', 'b', 'c', 'd'].map((id) => turn(id))
    const turnsAfterCoveredTurn = (contextManager as unknown as {
      turnsAfterCoveredTurn(turns: ConversationTurn[], coveredTurnEnd: string | null): ConversationTurn[]
    }).turnsAfterCoveredTurn
    expect(turnsAfterCoveredTurn(turns, 'b').map((item) => item.id)).toEqual(['c', 'd'])
    expect(turnsAfterCoveredTurn(turns, null)).toEqual(turns)
  })
})

describe('heuristicSummary', () => {
  it('emits all seven documented sections', () => {
    const summary = heuristicSummary([
      turn('a', { attachments: [{ id: 'file-1', name: 'spec.md', type: 'text/markdown', size: 10 }] }),
      turn('b', { status: 'failed' })
    ])
    for (const heading of ['Current goal', 'User constraints', 'Decisions', 'Completed', 'Open issues', 'Important references', 'Agent state']) {
      expect(summary).toContain(heading)
    }
    expect(summary).toContain('spec.md')
  })
})

describe('buildSummarySourceText', () => {
  it('includes the previous summary and trims to the char budget', () => {
    const source = buildSummarySourceText([turn('a')], '旧摘要内容', 40)
    expect(source).toContain('旧摘要内容')
    expect(source).toContain('待压缩回合')
  })
})

describe('projectCompactedState', () => {
  it('never reports more tokens than before compaction', () => {
    const before: ContextState = { conversationId: 'conversation-1', contextWindow: 128_000, estimatedTokens: 110_000, messageTokens: 90_000, toolTokens: 20_000, systemTokens: 0, countingMethod: 'provider-usage', compactionCount: 0, latestSummaryId: null, updatedAt: '2026-08-30T00:00:00.000Z' }
    const after = projectCompactedState(before, 'auto', '摘要'.repeat(100))
    expect(after.estimatedTokens).toBeLessThan(before.estimatedTokens)
    expect(after.toolTokens).toBeLessThan(before.toolTokens)
    expect(after.countingMethod).toBe('fallback-estimate')
  })
})
