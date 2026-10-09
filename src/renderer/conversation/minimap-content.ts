// 缩略图里那份「真实文字」的提取与切块：把消息正文解析成段落 / 标题 / 列表 / 代码块，
// 供缩略图按正文排版等比缩小渲染。纯文本处理，不碰 DOM。

import type { AgentEvent } from '../../shared/types'

export type MinimapBlockKind = 'heading' | 'paragraph' | 'list' | 'code' | 'quote'

export interface MinimapBlock {
  kind: MinimapBlockKind
  text: string
}

export interface MinimapContentLimits {
  /** 单段最多保留几块；缩略图只用来认分布，超出的部分认不出差别 */
  maxBlocks: number
  /** 单块最多保留多少字符，防止一个超长代码块把整张图撑满 */
  maxChars: number
}

export const DEFAULT_CONTENT_LIMITS: MinimapContentLimits = { maxBlocks: 24, maxChars: 400 }

const HEADING = /^\s{0,3}#{1,6}\s+/
const LIST = /^\s{0,3}(?:[-*+]\s+|\d{1,3}[.)]\s+)/
const QUOTE = /^\s{0,3}>\s?/
const FENCE = /^\s{0,3}(?:```|~~~)/

/**
 * markdown-lite 切块。
 *
 * 不复用正文那套完整 markdown 渲染：缩略图只需要「这一段长什么样」，
 * 把整棵 AST 建出来再缩到 25% 是纯浪费，而且会把渲染成本压到主对话流的热路径上。
 */
export function parseMinimapBlocks(text: string, limits: MinimapContentLimits = DEFAULT_CONTENT_LIMITS): MinimapBlock[] {
  const blocks: MinimapBlock[] = []
  let pending: { kind: MinimapBlockKind; lines: string[] } | null = null
  let fenced = false

  const flush = () => {
    if (!pending) return
    const body = pending.lines.join('\n').trim()
    if (body) blocks.push({ kind: pending.kind, text: body.slice(0, limits.maxChars) })
    pending = null
  }
  const push = (kind: MinimapBlockKind, line: string) => {
    if (pending && pending.kind === kind) pending.lines.push(line)
    else { flush(); pending = { kind, lines: [line] } }
  }

  for (const raw of text.split('\n')) {
    if (blocks.length >= limits.maxBlocks) break
    if (FENCE.test(raw)) {
      // 围栏本身不进内容：开栏要断开上一块，闭栏要把代码块收掉，两边都是 flush。
      flush()
      fenced = !fenced
      continue
    }
    if (fenced) { push('code', raw); continue }
    const line = raw.trim()
    if (!line) { flush(); continue }
    if (HEADING.test(raw)) { flush(); blocks.push({ kind: 'heading', text: line.replace(HEADING, '').slice(0, limits.maxChars) }); continue }
    if (LIST.test(raw)) { push('list', line); continue }
    if (QUOTE.test(raw)) { push('quote', line.replace(QUOTE, '')); continue }
    push('paragraph', line)
  }
  flush()
  return blocks.slice(0, limits.maxBlocks)
}

/**
 * 执行区的缩影：用工具名与简述充当文字纹理。
 * 这一段在正文里是执行轨迹卡片，没有可读正文，拿工具调用序列代替最能反映「这里在干活」。
 */
export function activityBlocks(events: AgentEvent[] | undefined, limits: MinimapContentLimits = DEFAULT_CONTENT_LIMITS): MinimapBlock[] {
  if (!events || events.length === 0) return []
  const lines: string[] = []
  for (const event of events) {
    if (lines.length >= limits.maxBlocks) break
    if (event.type !== 'tool_started') continue
    const detail = (event.detail ?? event.path ?? '').split('\n')[0].trim()
    lines.push(detail ? `${event.tool ?? 'tool'} ${detail}` : (event.tool ?? 'tool'))
  }
  if (lines.length === 0) return []
  return [{ kind: 'code', text: lines.join('\n').slice(0, limits.maxChars) }]
}

/** 悬停预览的摘要：取前几个有内容的块拼一小段，正常字号展示。 */
export function minimapPreviewText(blocks: MinimapBlock[], maxChars = 180): string {
  const joined = blocks.map((block) => block.text.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ')
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}…` : joined
}
