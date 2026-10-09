/**
 * 思考中的实时信号：从流式思考正文里取「现在在想什么」。
 * 只有一个转圈图标时，思考久了用户分不清是在推理还是卡住了；标题和末句随流式更新，本身就是进度。
 */

const HEADLINE_PATTERNS = [/^\*\*(.+?)\*\*[:：]?$/, /^#{1,6}\s+(.+)$/]
const HEADLINE_MAX = 40
const PREVIEW_MAX = 120

function matchHeadline(line: string): string | null {
  for (const pattern of HEADLINE_PATTERNS) {
    const title = pattern.exec(line)?.[1]?.trim()
    if (title) return title
  }
  return null
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * 模型自己写的小标题（独占一行的 `**分析布局**` 或 Markdown 标题），取最后一个。
 * 流式中途半截的 `**分析` 不算：等它写完整再换，免得标题逐字闪。
 */
export function thinkingHeadline(text: string): string | null {
  const lines = text.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const title = matchHeadline(lines[index].trim())
    if (title) return clip(title, HEADLINE_MAX)
  }
  return null
}

/**
 * 最新一句思考的纯文本尾部；标题行已经在过程头上，跳过。
 * 只剥加粗与行内代码记号，下划线要保留——`snake_case` 标识符剥了就读不懂了。
 */
export function thinkingPreview(text: string): string | null {
  const lines = text.split(/\r?\n/)
  let fenced = false
  let latest: string | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('```')) { fenced = !fenced; continue }
    if (fenced || !line || matchHeadline(line)) continue
    const plain = line.replace(/^(?:[-*+]\s+|\d+[.)]\s+|>\s*|#{1,6}\s+)/, '').replace(/\*\*|`/g, '').trim()
    if (plain) latest = plain
  }
  if (!latest) return null
  return latest.length > PREVIEW_MAX ? `…${latest.slice(-PREVIEW_MAX)}` : latest
}
