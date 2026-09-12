import type { CodeBlock, DiffBlock, MarkdownBlock, MessageBlock } from './blocks'

const FENCE = /^(\s{0,3})(`{3,})[ \t]*(.*)$/
const TITLE_ATTR = /(?:title|filename|file)\s*=\s*"([^"]+)"|(?:title|filename|file)\s*=\s*'([^']+)'/

/** 看起来像路径才当文件名，否则 ```ts twoslash 这种修饰词会被误认成文件。 */
function looksLikePath(token: string): boolean {
  if (!token || /^[{[(]/.test(token)) return false
  return token.includes('/') || token.includes('\\') || /\.[A-Za-z0-9]{1,8}$/.test(token)
}

export function parseFenceInfo(info: string): { language: string | null; filename: string | null } {
  const trimmed = info.trim()
  if (!trimmed) return { language: null, filename: null }
  const attr = TITLE_ATTR.exec(trimmed)
  const tokens = trimmed.replace(TITLE_ATTR, '').trim().split(/\s+/).filter(Boolean)
  const first = tokens[0] ?? ''
  // ```ts:src/foo.ts 这种写法把语言和文件名挤在一个 token 里。
  const colon = first.indexOf(':')
  let language = first || null
  let filename = attr?.[1] || attr?.[2] || null
  if (colon > 0 && looksLikePath(first.slice(colon + 1))) {
    language = first.slice(0, colon) || null
    filename = filename || first.slice(colon + 1)
  } else if (!filename && looksLikePath(first) && !tokens[1]) {
    // ```src/foo.ts —— 只给了文件名，语言从扩展名兜底。
    language = first.split('.').pop() || null
    filename = first
  }
  if (!filename) {
    const pathToken = tokens.slice(1).find(looksLikePath)
    if (pathToken) filename = pathToken
  }
  return { language: language ? language.toLowerCase() : null, filename }
}

export function diffStats(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { additions, deletions }
}

export function diffFilename(patch: string): string | null {
  for (const line of patch.split('\n')) {
    const git = /^diff --git a\/(\S+) b\/(\S+)/.exec(line)
    if (git) return git[2] || git[1]
    const plus = /^\+\+\+ (?:b\/)?(\S+)/.exec(line)
    if (plus && plus[1] !== '/dev/null') return plus[1]
    const minus = /^--- (?:a\/)?(\S+)/.exec(line)
    if (minus && minus[1] !== '/dev/null') return minus[1]
  }
  return null
}

function isDiffLanguage(language: string | null): boolean {
  return language === 'diff' || language === 'patch'
}

function markdownBlock(id: string, text: string): MarkdownBlock | null {
  return text.trim() ? { id, type: 'markdown', text: text.replace(/^\n+/, '').replace(/\n+$/, ''), status: 'completed' } : null
}

function fencedBlock(id: string, info: string, body: string, closed: boolean): CodeBlock | DiffBlock {
  const { language, filename } = parseFenceInfo(info)
  const status = closed ? 'completed' : 'streaming'
  if (isDiffLanguage(language)) {
    const stats = diffStats(body)
    return { id, type: 'diff', filename: filename ?? diffFilename(body), patch: body, additions: stats.additions, deletions: stats.deletions, status }
  }
  return { id, type: 'code', language, filename, code: body, status }
}

/**
 * 把一段 assistant 文本切成 Markdown / Code / Diff blocks。
 * ID 用「消息 ID + 序号」：流式输出是追加式的，前面的块序号不会变，因此 ID 稳定。
 */
export function parseBlocks(text: string, messageId: string): MessageBlock[] {
  const blocks: MessageBlock[] = []
  const lines = text.split('\n')
  let buffer: string[] = []
  let fenceMarker = ''
  let fenceInfo = ''
  let fenceIndent = 0
  let inFence = false

  const nextId = () => `${messageId}-${blocks.length}`

  const flushMarkdown = () => {
    const block = markdownBlock(nextId(), buffer.join('\n'))
    if (block) blocks.push(block)
    buffer = []
  }

  for (const line of lines) {
    const match = FENCE.exec(line)
    if (!inFence) {
      if (match) {
        flushMarkdown()
        inFence = true
        fenceMarker = match[2]
        fenceInfo = match[3]
        fenceIndent = match[1].length
        continue
      }
      buffer.push(line)
      continue
    }
    // 收尾围栏必须不短于开启围栏，且后面不带 info string。
    if (match && match[2].length >= fenceMarker.length && !match[3].trim()) {
      blocks.push(fencedBlock(nextId(), fenceInfo, buffer.join('\n'), true))
      buffer = []
      inFence = false
      continue
    }
    buffer.push(fenceIndent && line.startsWith(' '.repeat(fenceIndent)) ? line.slice(fenceIndent) : line)
  }

  if (inFence) blocks.push(fencedBlock(nextId(), fenceInfo, buffer.join('\n'), false))
  else flushMarkdown()
  return blocks
}
