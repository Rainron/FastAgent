import { DEFAULT_KNOWLEDGE_SETTINGS } from '../shared/knowledge-settings'
import { describe, expect, it } from 'vitest'
import { buildSummarySourceText, heuristicSummary, piCompactionSettings, projectCompactedState, resolvePolicy, splitTurns } from './context-manager'
import * as contextManager from './context-manager'
import { compactionBudget } from '../shared/context-policy'
import type { AppSettings, ContextPolicy, ContextState, ConversationTurn } from '../shared/types'
import { defaultSandboxSettings } from '../shared/sandbox'
import { DEFAULT_ATTACHMENT_POLICY } from '../shared/attachment-policy'
import { DEFAULT_RUN_LIMITS } from './local-store/row-mappers'
import { SUBAGENT_DEFAULT_MAX_TOOL_CALLS } from '../shared/subagent'

const settings: AppSettings = {
  ...DEFAULT_ATTACHMENT_POLICY,
  knowledge: DEFAULT_KNOWLEDGE_SETTINGS,
  motionPreference: 'system',
  startAtLogin: false,
  showOnStartup: true,
  closeToTray: true,
  theme: 'system',
  autoSummary: true,
  contextStrategy: 'disabled',
  triggerRatio: null,
  keepRecentTurns: null,
  forceCompaction: false,
  shellPreference: 'bash',
  bashPath: '',
  externalEditorPath: '',
  agentAbilityPolicy: { mode: 'all_enabled', agentAbilityIds: [] },
  subAgentEnabled: true,
  subAgentMaxToolCalls: SUBAGENT_DEFAULT_MAX_TOOL_CALLS,
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
  return { conversationId: 'conversation-1', strategy: 'auto', autoSummary: true, triggerRatio: null, keepRecentTurns: null, forceCompaction: false, inheritGlobal: true, ...patch }
}

describe('resolvePolicy', () => {
  it('maps global contextStrategy onto the policy strategy field', () => {
    expect(resolvePolicy(settings, null, 'conversation-1')).toEqual({
      conversationId: 'conversation-1',
      strategy: 'disabled',
      autoSummary: true,
      triggerRatio: null,
      keepRecentTurns: null,
      forceCompaction: false,
      inheritGlobal: true
    })
  })

  it('prefers the stored conversation policy', () => {
    const stored = policy({ strategy: 'aggressive', inheritGlobal: false })
    expect(resolvePolicy(settings, stored, 'conversation-1')).toBe(stored)
  })

  // 策略行写过就一直在，只看「有没有行」会让这条会话此后对全局设置免疫。
  it('声明跟随全局的策略行不会挡住全局设置', () => {
    const stored = policy({ strategy: 'aggressive', triggerRatio: 0.4, inheritGlobal: true })
    expect(resolvePolicy(settings, stored, 'conversation-1')).toMatchObject({ strategy: 'disabled', triggerRatio: null, inheritGlobal: true })
  })
})

describe('piCompactionSettings', () => {
  // Pi 的判定是 tokens > contextWindow - reserveTokens，所以 reserveTokens 就是触发占比的补数。
  // 保留区不再由「目标占比 − 摘要预算」反推，直接按窗口的固定比例（25%）给。
  it('把档位触发占比换算成 Pi 的 reserveTokens，保留区按窗口固定比例', () => {
    // conservative 触发 85% → reserve 15%；保留区 128000×25%
    expect(piCompactionSettings(policy({ strategy: 'conservative' }), 128_000)).toEqual({ enabled: true, reserveTokens: 19_200, keepRecentTokens: 32_000 })
    // aggressive 触发 68% → reserve 32%，保留区不变
    expect(piCompactionSettings(policy({ strategy: 'aggressive' }), 128_000)).toEqual({ enabled: true, reserveTokens: 40_960, keepRecentTokens: 32_000 })
  })

  it('显式 triggerRatio 优先于档位默认值', () => {
    expect(piCompactionSettings(policy({ strategy: 'conservative', triggerRatio: 0.5 }), 128_000).reserveTokens).toBe(64_000)
  })

  it('保留区不随触发点变化，用户只调一个旋钮', () => {
    const low = compactionBudget(policy({ triggerRatio: 0.4 }), 128_000)
    const high = compactionBudget(policy({ triggerRatio: 0.9 }), 128_000)
    expect(low.keepRecentTokens).toBe(high.keepRecentTokens)
    expect(low.triggerTokens).toBeLessThan(high.triggerTokens)
  })

  it('落点一定低于触发点：压完立刻又越线就会无限压下去', () => {
    for (const contextWindow of [8_000, 16_384, 32_768, 128_000, 1_000_000]) {
      for (const triggerRatio of [0.3, 0.4, 0.5, 0.78, 0.95]) {
        for (const maxTokens of [null, 8_192, 512_000]) {
          const budget = compactionBudget(policy({ triggerRatio }), contextWindow, maxTokens)
          // Pi 给摘要的 maxTokens 是 min(0.8×reserve, model.maxTokens)，按真实值判
          const summaryBudget = Math.min(Math.floor(budget.reserveTokens * 0.8), maxTokens ?? 8_192)
          expect(budget.keepRecentTokens + summaryBudget).toBeLessThan(budget.triggerTokens)
        }
      }
    }
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
    const after = projectCompactedState(before, policy({ strategy: 'auto' }), '摘要'.repeat(100))
    expect(after.estimatedTokens).toBeLessThan(before.estimatedTokens)
    expect(after.toolTokens).toBeLessThan(before.toolTokens)
    expect(after.countingMethod).toBe('fallback-estimate')
  })

})
