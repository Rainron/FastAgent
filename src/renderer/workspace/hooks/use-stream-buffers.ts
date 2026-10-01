import { useEffect, useMemo, useRef } from 'react'
import type { ConversationTurn } from '../../../shared/types'
import { createStreamBuffer } from '../../ai-response/stream-buffer'

/** 思考正文的冲刷间隔：只在折叠层显示，没必要跟正文一样每帧重绘整棵树。 */
const THINKING_FLUSH_MS = 200

/**
 * 流式文本的两条缓冲。token 不逐个进 state：按 turn 累积，定时冲刷成一次渲染。
 *
 * streamedTextRef 是跨会话存活的助手文本缓存：turns state 只装当前打开的会话，
 * 切走就没了，切回来时由 mergeStreamedText 贴回历史。
 */
export function useStreamBuffers(setTurns: React.Dispatch<React.SetStateAction<ConversationTurn[]>>) {
  const streamedTextRef = useRef(new Map<string, string>())

  const streamBuffer = useMemo(() => createStreamBuffer((chunks) => {
    // 用 Map 索引：turns 与 chunks 都可能不止一条，逐个 find 会退化成 O(turns × chunks)。
    const byTurn = new Map(chunks.map((chunk) => [chunk.turnId, chunk.text]))
    for (const [turnId, text] of byTurn) {
      streamedTextRef.current.set(turnId, `${streamedTextRef.current.get(turnId) ?? ''}${text}`)
    }
    setTurns((current) => {
      // 冲刷目标不在当前会话时直接保留原数组，省掉一次无意义的整表重建与重渲染。
      if (!current.some((turn) => byTurn.has(turn.id))) return current
      return current.map((turn) => {
        const text = byTurn.get(turn.id)
        if (text === undefined) return turn
        const createdAt = turn.assistantMessage?.createdAt || new Date().toISOString()
        return { ...turn, assistantMessage: { text: `${turn.assistantMessage?.text || ''}${text}`, createdAt }, updatedAt: new Date().toISOString() }
      })
    })
  }), [setTurns])
  useEffect(() => () => streamBuffer.dispose(), [streamBuffer])

  const thinkingBuffer = useMemo(() => createStreamBuffer((chunks) => {
    const byTurn = new Map(chunks.map((chunk) => [chunk.turnId, chunk.text]))
    setTurns((current) => {
      if (!current.some((turn) => byTurn.has(turn.id) && turn.activity)) return current
      return current.map((turn) => {
        const text = byTurn.get(turn.id)
        if (text === undefined || !turn.activity) return turn
        // 分段与全文同步推进：段由 thinking_started 开出来，没开过就补一段，免得实时文本无处可放。
        const segments = turn.activity.thinkingSegments?.length ? [...turn.activity.thinkingSegments] : ['']
        segments[segments.length - 1] += text
        return { ...turn, activity: { ...turn.activity, thinking: `${turn.activity.thinking || ''}${text}`, thinkingSegments: segments } }
      })
    })
  }, THINKING_FLUSH_MS), [setTurns])
  useEffect(() => () => thinkingBuffer.dispose(), [thinkingBuffer])

  return { streamBuffer, thinkingBuffer, streamedTextRef }
}
