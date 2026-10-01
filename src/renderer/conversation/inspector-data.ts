import { resolveEffectivePolicy } from '../../shared/context-policy'
import type { AppSettings, ConversationDetailed, ConversationTurn, ModelOption, ModelUsageSummary, ToolCallRecord } from '../../shared/types'
import type { ConversationInspectorData } from './ConversationInspector'
import type { ContextHealthData } from './ContextHealth'

export interface InspectorMapInput {
  detail: ConversationDetailed
  history: ConversationTurn[]
  /** 末轮的工具调用明细；没有末轮时为空数组。 */
  latestToolCalls: ToolCallRecord[]
  model: ModelOption | undefined
  /** 权限档位 id → 展示名，档位可增删所以由调用方解析好再传进来。 */
  permissionLabel: string | undefined
  /** detail.context 缺失时的回落值（当前会话面板上的用量）。 */
  fallbackContext: ContextHealthData
  /** 模型缓存面板的数据；取不到时面板显示「尚无请求用量」。 */
  usage?: ModelUsageSummary
  /** 会话没有自己的策略行、或声明跟随全局时，面板要展示的就是这份全局设置。 */
  settings: Pick<AppSettings, 'autoSummary' | 'contextStrategy' | 'triggerRatio' | 'keepRecentTurns' | 'forceCompaction'> | null
}

/**
 * 会话详情面板的数据映射。纯函数：IPC 取数留在组件里，
 * 这一段口径（回合序号换算、事件统计、回落规则）单独可测。
 */
export function buildInspectorData(input: InspectorMapInput): ConversationInspectorData {
  const { detail, history, latestToolCalls, model, permissionLabel, fallbackContext, settings, usage } = input
  // 面板展示的必须是「实际生效的那一份」：策略行存在但声明跟随全局时，生效的是全局设置。
  const effectivePolicy = settings
    ? resolveEffectivePolicy(settings, detail.contextPolicy, detail.id)
    : detail.contextPolicy
  // 压缩记录存的是回合 ID，转成 1 基序号才能显示「覆盖回合范围」。
  const turnIndex = new Map(history.map((turn, index) => [turn.id, index + 1]))
  const agentEvents = history.flatMap((turn) => turn.activity?.events || [])
  const latestTurn = history.at(-1)

  return {
    conversation: { id: detail.id, title: detail.title, createdAt: detail.createdAt, updatedAt: detail.updatedAt },
    runtime: {
      mode: detail.runtime.mode || 'chat',
      model: model?.name || (detail.runtime.modelId ? String(detail.runtime.modelId) : '未选择'),
      provider: detail.runtime.provider || model?.provider,
      reasoning: detail.runtime.thinkingLevel || undefined,
      permission: permissionLabel,
      status: detail.runtime.status || 'idle',
      agentSessionId: detail.runtime.sessionId,
      // 策略编辑器要按它估摘要预算，否则「压到 X%」会和设置页对不上。
      maxTokens: model?.max_tokens ?? null
    },
    context: detail.context
      ? { ...detail.context, latestCompactionAt: detail.compactionHistory[0]?.createdAt || null, usage: usage ?? undefined, usagePending: false }
      : { ...fallbackContext, usage: usage ?? fallbackContext.usage },
    summary: detail.summary ? { text: detail.summary.summaryText, version: detail.summary.version, createdAt: detail.summary.createdAt } : null,
    history: detail.compactionHistory.map((item) => ({
      id: item.id,
      beforeTokens: item.beforeTokens,
      afterTokens: item.afterTokens,
      triggerReason: item.triggerReason,
      coveredTurnStart: turnIndex.get(item.coveredTurnStart || '') ?? null,
      coveredTurnEnd: turnIndex.get(item.coveredTurnEnd || '') ?? null,
      strategy: item.strategy,
      summaryText: item.summaryText ?? null,
      createdAt: item.createdAt
    })),
    agent: {
      toolCalls: agentEvents.filter((event) => event.type === 'tool_started').length,
      latestStep: agentEvents.at(-1)?.detail || agentEvents.at(-1)?.tool || null,
      failureReason: agentEvents.filter((event) => event.type === 'failed').at(-1)?.detail || null,
      startedAt: latestTurn?.activity?.startedAt ?? null,
      finishedAt: latestTurn?.activity?.finishedAt ?? null,
      toolCallsDetailed: latestToolCalls
    },
    policy: effectivePolicy ? {
      strategy: effectivePolicy.strategy,
      triggerRatio: effectivePolicy.triggerRatio,
      autoSummary: effectivePolicy.autoSummary,
      forceCompaction: effectivePolicy.forceCompaction,
      // 覆盖与否由存档那一行说了算，不能看 resolve 之后的结果——那一份总是 inheritGlobal。
      inheritGlobal: detail.contextPolicy?.inheritGlobal !== false
    } : undefined
  }
}
