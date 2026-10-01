import { useEffect, useState } from 'react'

// 空集合用模块级常量：MessageList 是 memo 组件，每次渲染新建 Set 会穿透 memo。
const EMPTY_MEMORY_TURN_IDS: ReadonlySet<string> = new Set()
const EMPTY_CONTEXT_SOURCE_TURN_IDS: ReadonlySet<string> = new Set()

/**
 * 回合级活动标记：哪些回合有记忆召回/提取，哪些回合记了上下文来源。
 *
 * 记忆集随会话切换与 memories:changed（本轮抽取写入/删除）重拉。
 * 来源集由主进程在每轮开跑时写入，因此按「会话 / 轮次数 / 运行结束」重拉——
 * 不进流式路径：runId 一轮只变两次，turnCount 在流式期间不变。
 */
export function useTurnActivitySets(selectedConversationId: string | null, turnCount: number, runId: string | null) {
  const [memoryTurnIds, setMemoryTurnIds] = useState<ReadonlySet<string>>(EMPTY_MEMORY_TURN_IDS)
  const [memoryActivityVersion, setMemoryActivityVersion] = useState(0)
  const [contextSourceTurnIds, setContextSourceTurnIds] = useState<ReadonlySet<string>>(EMPTY_CONTEXT_SOURCE_TURN_IDS)

  useEffect(() => {
    const dispose = window.fastAgent.memories.onChanged(() => setMemoryActivityVersion((value) => value + 1))
    return dispose
  }, [])

  useEffect(() => {
    if (!selectedConversationId) { setMemoryTurnIds(EMPTY_MEMORY_TURN_IDS); return }
    let cancelled = false
    void window.fastAgent.memories.conversationActivity(selectedConversationId)
      .then((ids) => { if (!cancelled) setMemoryTurnIds(new Set(ids)) })
      .catch(() => { if (!cancelled) setMemoryTurnIds(EMPTY_MEMORY_TURN_IDS) })
    return () => { cancelled = true }
  }, [selectedConversationId, memoryActivityVersion])

  useEffect(() => {
    if (!selectedConversationId) { setContextSourceTurnIds(EMPTY_CONTEXT_SOURCE_TURN_IDS); return }
    let cancelled = false
    void window.fastAgent.conversations.contextSourceTurns(selectedConversationId)
      .then((ids) => { if (!cancelled) setContextSourceTurnIds(new Set(ids)) })
      .catch(() => { if (!cancelled) setContextSourceTurnIds(EMPTY_CONTEXT_SOURCE_TURN_IDS) })
    return () => { cancelled = true }
  }, [selectedConversationId, turnCount, runId])

  return { memoryTurnIds, contextSourceTurnIds }
}
