import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ConversationTurn } from '../../shared/types'
import type { MessageBlock } from './blocks'
import { parseBlocks } from './block-parser'
import { MessageBlockRenderer } from './MessageBlockRenderer'
import { MessageActions } from './MessageActions'
import { blocksToPlainText, normalizeAssistantMessage } from './message-normalizer'
import { scheduleTextSampling } from './sampling-timer'

/**
 * 流式期间按固定间隔采样最新文本，避免逐 token 触发 Markdown 解析；
 * 切换 turn 时立即同步一次，防止上一条回复的尾部闪现。
 * 间隔本身不随 turn 变化，采样读的是 ref，不会因文本更新而重置计时器。
 */
function useSampledText(text: string, turnId: string, streaming: boolean, intervalMs = 300): string {
  const [shown, setShown] = useState(text)
  const latest = useRef(text)
  latest.current = text
  useEffect(() => {
    setShown(latest.current)
    return scheduleTextSampling(streaming, () => setShown(latest.current), intervalMs)
  }, [turnId, streaming, intervalMs])
  return shown
}

/**
 * 助手消息的唯一入口：turn 先归一化成 blocks，再逐块分发。
 * 旧会话里 assistantMessage 只有字符串，归一化时自动变成 MarkdownBlock。
 */
export const AssistantMessageView = React.memo(function AssistantMessageView({ turn, textStart = 0, onRegenerate, onDelete, onCopyPair }: {
  turn: ConversationTurn
  /** 执行轨迹已归档正文前段，正文区只渲染从这里开始的最终回答。 */
  textStart?: number
  onRegenerate: () => void
  onDelete: () => void
  onCopyPair: () => void
}) {
  const fullText = turn.assistantMessage?.text ?? ''
  // 流式阶段用采样文本解析 blocks（最后一块仍在增长，标记 streaming）；终态才做完整归一化（含错误/取消块）。
  const text = fullText.slice(textStart)
  const streaming = turn.status === 'working'
  const streamedText = useSampledText(text, turn.id, streaming)
  const streamBlocks = useMemo<MessageBlock[]>(() => {
    if (!streaming) return []
    const blocks = parseBlocks(streamedText, turn.id)
    if (blocks.length) {
      const last = blocks[blocks.length - 1]
      blocks[blocks.length - 1] = { ...last, status: 'streaming' }
    }
    return blocks
  }, [streaming, streamedText, turn.id])
  const message = useMemo(() => (streaming ? null : normalizeAssistantMessage(turn, textStart)), [turn, streaming, textStart])
  // 「复制为纯文本」基于完整正文，避免正文区切片后把轨迹里的前段说明丢掉。
  const plainText = useMemo(() => blocksToPlainText(parseBlocks(fullText, turn.id)), [fullText, turn.id])

  if (streaming) {
    if (!streamedText.trim()) return null
    return (
      <div className="assistant-message streaming">
        <div className="assistant-blocks">
          {streamBlocks.map((block) => <MessageBlockRenderer key={block.id} block={block} />)}
          <span className="streaming-caret" aria-hidden="true" />
        </div>
      </div>
    )
  }
  if (!message) return null
  return (
    <div className={`assistant-message ${message.status}`}>
      <div className="assistant-blocks">
        {message.blocks.map((block) => <MessageBlockRenderer key={block.id} block={block} />)}
      </div>
      <MessageActions
        markdown={turn.assistantMessage?.text ?? ''}
        plainText={plainText}
        onRegenerate={onRegenerate}
        onDelete={onDelete}
        onCopyPair={onCopyPair}
      />
    </div>
  )
})
