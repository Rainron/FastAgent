import type { ConversationDetailed, ConversationTurn, ModelOption, ToolCallRecord } from '../../shared/types'
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
}

/**
 * 会话详情面板的数据映射。纯函数：IPC 取数留在组件里，
 * 这一段口径（回合序号换算、事件统计、回落规则）单独可测。
 */
export function buildInspectorData(input: InspectorMapInput): ConversationInspectorData {
  const { detail, history, latestToolCalls, model, permissionLabel, fallbackContext } = input
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
      agentSessionId: detail.runtime.sessionId
    },
    context: detail.context ? { ...detail.context, latestCompactionAt: detail.compactionHistory[0]?.createdAt || null } : fallbackContext,
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
    policy: detail.contextPolicy ? {
      strategy: detail.contextPolicy.strategy,
      triggerRatio: detail.contextPolicy.triggerRatio,
      targetRatio: detail.contextPolicy.targetRatio,
      autoSummary: detail.contextPolicy.autoSummary,
      inheritGlobal: detail.contextPolicy.inheritGlobal
    } : undefined
  }
}
