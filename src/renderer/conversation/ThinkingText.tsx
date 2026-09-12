import { memo, useMemo } from 'react'
import { parseBlocks } from '../ai-response/block-parser'
import { MessageBlockRenderer } from '../ai-response/MessageBlockRenderer'

/**
 * 思考正文：模型的推理同样是 Markdown（列表、代码块、标题都有），
 * 按纯文本贴出来会把结构拍平，这里与正文区走同一套块渲染，只在样式上压到次级。
 */
export const ThinkingText = memo(function ThinkingText({ id, text, className }: { id: string; text: string; className: string }) {
  const blocks = useMemo(() => parseBlocks(text, id), [text, id])
  if (!blocks.length) return null
  return <div className={className}>{blocks.map((block) => <MessageBlockRenderer key={block.id} block={block} />)}</div>
})
