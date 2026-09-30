/**
 * 文本切块：知识库要能把回答落回「哪个文件的哪几行」，因此每一块都必须带行号区间。
 * 切块不做语义理解，只按结构（Markdown 标题 / 空行）与长度预算切，切不动时按行硬切。
 */

export interface TextChunk {
  /** 块标题：Markdown 取所属标题链，其余取「文件名 · 行区间」由调用方补。 */
  title: string
  text: string
  /** 1 起算，闭区间。 */
  startLine: number
  endLine: number
}

export interface ChunkOptions {
  /** 单块字符上限；超过就继续切。 */
  maxChars?: number
  /** 小于这个长度的尾块并回上一块，避免产生只有一行的碎片。 */
  minChars?: number
}

const DEFAULT_MAX_CHARS = 1_600
const DEFAULT_MIN_CHARS = 120

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/

interface Line {
  text: string
  number: number
}

/** 标题链：h1 > h2 > h3，供块标题保留上下文，光有 “概述” 两个字定位不了。 */
function headingTrail(trail: readonly string[]): string {
  return trail.filter(Boolean).join(' › ')
}

function toChunk(title: string, lines: readonly Line[]): TextChunk | null {
  const text = lines.map((line) => line.text).join('\n').trim()
  if (!text) return null
  return { title, text, startLine: lines[0].number, endLine: lines[lines.length - 1].number }
}

/**
 * 按长度预算把一段行切成若干块。优先在空行处断开：
 * 从中间硬切会把一个代码块或一段列表劈成两半，检索命中后读起来是断的。
 */
function splitByBudget(title: string, lines: readonly Line[], maxChars: number): TextChunk[] {
  const chunks: TextChunk[] = []
  let current: Line[] = []
  let used = 0
  let lastBlank = -1
  for (const line of lines) {
    const cost = line.text.length + 1
    if (used + cost > maxChars && current.length) {
      // 有空行就在最后一个空行断，没有就在当前位置断。
      const cut = lastBlank > 0 ? lastBlank : current.length
      const head = current.slice(0, cut)
      const chunk = toChunk(title, head)
      if (chunk) chunks.push(chunk)
      current = current.slice(cut)
      used = current.reduce((sum, item) => sum + item.text.length + 1, 0)
      lastBlank = -1
    }
    current.push(line)
    used += cost
    if (!line.text.trim()) lastBlank = current.length
  }
  const tail = toChunk(title, current)
  if (tail) chunks.push(tail)
  return chunks
}

/** 尾块过短时并回上一块：一行残片单独成条只会污染检索结果。 */
function mergeTail(chunks: readonly TextChunk[], minChars: number): TextChunk[] {
  if (chunks.length < 2) return [...chunks]
  const result = chunks.slice(0, -1)
  const tail = chunks[chunks.length - 1]
  const previous = result[result.length - 1]
  if (tail.text.length >= minChars || previous.title !== tail.title) return [...result, tail]
  result[result.length - 1] = { ...previous, text: `${previous.text}\n${tail.text}`, endLine: tail.endLine }
  return result
}

/** Markdown：按标题切段，段内超预算再按空行细切，块标题保留标题链。 */
export function chunkMarkdown(content: string, options: ChunkOptions = {}): TextChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS
  const lines: Line[] = content.replace(/\r\n?/g, '\n').split('\n').map((text, index) => ({ text, number: index + 1 }))
  const sections: Array<{ title: string; lines: Line[] }> = []
  const trail: string[] = []
  let currentTitle = ''
  let currentLines: Line[] = []
  // 围栏代码块里的 # 是注释不是标题，切在这里会把代码劈开。
  let inFence = false
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line.text)) inFence = !inFence
    const heading = inFence ? null : line.text.match(HEADING)
    if (heading) {
      if (currentLines.length) sections.push({ title: currentTitle, lines: currentLines })
      const level = heading[1].length
      trail.length = Math.min(trail.length, level - 1)
      trail[level - 1] = heading[2]
      currentTitle = headingTrail(trail)
      currentLines = [line]
      continue
    }
    currentLines.push(line)
  }
  if (currentLines.length) sections.push({ title: currentTitle, lines: currentLines })
  const chunks = sections.flatMap((section) => splitByBudget(section.title, section.lines, maxChars))
  return mergeTail(chunks.filter((chunk) => chunk.text.trim().length > 0), minChars)
}

/** 纯文本与代码：没有可靠的结构信号，只按长度与空行切。 */
export function chunkPlainText(content: string, options: ChunkOptions = {}): TextChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS
  const lines: Line[] = content.replace(/\r\n?/g, '\n').split('\n').map((text, index) => ({ text, number: index + 1 }))
  return mergeTail(splitByBudget('', lines, maxChars), minChars)
}

export type ChunkKind = 'markdown' | 'text'

export function chunkContent(content: string, kind: ChunkKind, options: ChunkOptions = {}): TextChunk[] {
  return kind === 'markdown' ? chunkMarkdown(content, options) : chunkPlainText(content, options)
}

/** 行区间定位串；检索结果与引用都用它，界面据此跳到文件的具体位置。 */
export function lineLocator(chunk: Pick<TextChunk, 'startLine' | 'endLine'>): string {
  return chunk.startLine === chunk.endLine ? `L${chunk.startLine}` : `L${chunk.startLine}-${chunk.endLine}`
}

/** PDF 没有行号，用页码定位。 */
export function pageLocator(page: number): string {
  return `p.${page}`
}

/** 块标题：Markdown 有标题链就用它，否则回退到「文件名 · 定位」，保证条目列表里能分辨。 */
export function chunkTitle(fileName: string, chunk: TextChunk): string {
  return chunk.title.trim() ? `${fileName} › ${chunk.title.trim()}` : `${fileName} · ${lineLocator(chunk)}`
}
