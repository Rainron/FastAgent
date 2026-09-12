import { describe, expect, it } from 'vitest'
import { buildSummarySourceText, contextTargetRatio, heuristicSummary, projectCompactedState, resolvePolicy, shouldCompact, splitTurns, triggerRatioFor } from './context-manager'
import * as contextManager from './context-manager'
import type { AppSettings, ContextPolicy, ContextState, ConversationTurn } from '../shared/types'
import { defaultSandboxSettings } from '../shared/sandbox'

const settings: AppSettings = {
  startAtLogin: false,
  showOnStartup: true,
  closeToTray: true,
  theme: 'system',
  autoSummary: true,
  contextStrategy: 'disabled',
  triggerRatio: null,
  keepRecentTurns: null,
  shellPreference: 'bash',
  bashPath: '',
  externalEditorPath: '',
  agentAbilityPolicy: { mode: 'all_enabled', agentAbilityIds: [] },
  subAgentEnabled: true,
  memory: { enabled: true, autoExtract: true, maxRecall: 5, extractModelId: null },
  sandbox: defaultSandboxSettings,
  quickDialogEnabled: true
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
  return { conversationId: 'conversation-1', strategy: 'auto', autoSummary: true, triggerRatio: null, keepRecentTurns: null, inheritGlobal: true, ...patch }
}

const state: Pick<ContextState, 'estimatedTokens' | 'contextWindow'> = { estimatedTokens: 120_000, contextWindow: 128_000 }

describe('resolvePolicy', () => {
  it('maps global contextStrategy onto the policy strategy field', () => {
    expect(resolvePolicy(settings, null, 'conversation-1')).toEqual({
      conversationId: 'conversation-1',
      strategy: 'disabled',
      autoSummary: true,
      triggerRatio: null,
      keepRecentTurns: null,
      inheritGlobal: true
    })
  })

  it('prefers the stored conversation policy', () => {
    const stored = policy({ strategy: 'aggressive', inheritGlobal: false })
    expect(resolvePolicy(settings, stored, 'conversation-1')).toBe(stored)
  })
})

describe('shouldCompact', () => {
  it('never compacts when the strategy is disabled', () => {
    expect(shouldCompact(policy({ strategy: 'disabled' }), state)).toBe(false)
    expect(shouldCompact(resolvePolicy(settings, null, 'conversation-1'), state)).toBe(false)
  })

  it('never compacts when auto summary is off', () => {
    expect(shouldCompact(policy({ autoSummary: false }), state)).toBe(false)
  })

  it('compacts once usage reaches the strategy threshold', () => {
    expect(shouldCompact(policy(), { estimatedTokens: 100_000, contextWindow: 128_000 })).toBe(true)
    expect(shouldCompact(policy({ strategy: 'conservative' }), { estimatedTokens: 100_000, contextWindow: 128_000 })).toBe(false)
    expect(shouldCompact(policy({ strategy: 'conservative' }), state)).toBe(true)
  })

  it('lets an explicit trigger ratio win over the strategy default', () => {
    expect(shouldCompact(policy({ strategy: 'conservative', triggerRatio: 0.5 }), { estimatedTokens: 70_000, contextWindow: 128_000 })).toBe(true)
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
