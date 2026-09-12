import type { MemoryRecord, MemoryScope, MemoryType } from '../../../shared/types'

/** 单条抽取结果。replaces 是既有记忆的序号（1 起），由调用方映射成 id。 */
export interface MemoryCandidate {
  type: MemoryType
  scope: MemoryScope
  content: string
  importance: number
  replaces: number[]
}

export const MAX_CANDIDATES = 5
export const MAX_CANDIDATE_CHARACTERS = 200
/** 送进抽取提示的既有记忆条数：只用于让模型判断替代关系，不需要全量。 */
export const MAX_EXISTING_IN_PROMPT = 20

const TRIVIAL = /^(好的?|行|可以|继续|收到|没问题|明白|懂了|谢谢|多谢|辛苦了?|嗯+|ok|okay|thanks|thank you|got it|go on|yes|no)[。.!！~\s]*$/i

const TYPES: MemoryType[] = ['preference', 'fact', 'decision', 'experience']
const SCOPES: MemoryScope[] = ['global', 'workspace', 'agent']

export interface ExtractionSource {
  userText: string
  assistantText: string
}

/**
 * 规则前置过滤：抽取要多跑一次模型，逐轮都跑纯属浪费。
 * 只挡明确无信息量的回合，判断放宽——漏挡一次只是多一次调用，误挡会永久丢掉事实。
 */
export function shouldExtractMemories(source: ExtractionSource): boolean {
  const user = source.userText.trim()
  if (user.length < 4) return false
  if (TRIVIAL.test(user)) return false
  // 助手没有产出的回合（失败 / 取消）不代表任何已确认的信息。
  if (!source.assistantText.trim()) return false
  return true
}

function formatExisting(existing: readonly MemoryRecord[]): string {
  if (!existing.length) return '（当前作用域没有已保存的记忆）'
  return existing.slice(0, MAX_EXISTING_IN_PROMPT)
    .map((memory, index) => `${index + 1}. [${memory.type}] ${memory.content}`)
    .join('\n')
}

export function buildExtractionPrompt(source: ExtractionSource, existing: readonly MemoryRecord[], hasWorkspace: boolean): string {
  return `你在为一个编码助手维护长期记忆。判断下面这轮对话里有没有值得跨会话保存的信息。

只保存这四类：
- preference：用户长期偏好（工具链、风格、交流方式）
- fact：项目或环境的稳定事实（技术栈、目录约定、外部依赖）
- decision：已经拍板的技术决定
- experience：可复用的经验教训

不要保存：一次性任务描述、临时状态、寒暄、可以从代码里直接读到的信息、任何密钥或凭据。
如果没有值得保存的信息，只输出一行 NONE。

已保存的记忆：
${formatExisting(existing)}

本轮用户输入：
${source.userText.slice(0, 4000)}

本轮助手回复：
${source.assistantText.slice(0, 4000)}

输出格式，每条一行，最多 ${MAX_CANDIDATES} 行：
- [类型|作用域|重要性] 内容 <替代:序号,序号>

类型取 preference/fact/decision/experience；作用域取 ${hasWorkspace ? 'workspace（只与当前项目有关）或 global（与项目无关的通用偏好）' : 'global（当前会话未归属项目，只能用 global）'}；重要性取 1~5。
内容写成不依赖上下文也能读懂的一句话，不超过 ${MAX_CANDIDATE_CHARACTERS} 字。
只有当新记忆明确推翻某条已保存记忆时，才加 <替代:序号>；否则省略该后缀。`
}

/**
 * 记忆会被持久化并在之后每一轮反复注入 prompt，一旦把凭据写进去就等于长期泄漏。
 * 提示词里已经要求模型不要保存密钥，这里再按形态兜一层：宁可丢一条记忆，不能留一份凭据。
 */
const SECRET_PATTERNS = [
  /-----begin [a-z ]*private key-----/i,
  /\b(?:sk|pk|ghp|gho|ghs|ghu|glpat)[-_][A-Za-z0-9_-]{16,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./,
  /\b(?:api[\s_-]?key|access[\s_-]?token|secret|password|passwd|pwd|凭据|密钥|口令)\s*[:=：]\s*\S{6,}/i
]

export function containsSecretLike(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
}

function pickType(tokens: string[]): MemoryType | null {
  return TYPES.find((type) => tokens.includes(type)) ?? null
}

function pickScope(tokens: string[]): MemoryScope | null {
  return SCOPES.find((scope) => tokens.includes(scope)) ?? null
}

function pickImportance(tokens: string[]): number {
  const found = tokens.map((token) => Number(token)).find((value) => Number.isInteger(value) && value >= 1 && value <= 5)
  return found ?? 3
}

/**
 * 模型输出的容错解析。不用 JSON：这类小任务里模型破坏 JSON 结构的失败模式
 * （整条丢弃）比丢字段严重，分段格式坏一行只影响一行。
 */
export function parseMemoryCandidates(text: string, hasWorkspace: boolean): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || /^none$/i.test(line)) continue
    const matched = /^[-*+]?\s*\[([^\]]+)\]\s*(.+)$/.exec(line)
    if (!matched) continue
    const tokens = matched[1].toLowerCase().split(/[|,，/\s]+/).filter(Boolean)
    const type = pickType(tokens)
    if (!type) continue
    let body = matched[2].trim()
    const replaces: number[] = []
    const replaceMatch = /[<（(]\s*(?:替代|replaces?)\s*[:：]\s*([\d,，\s]+)\s*[>）)]/i.exec(body)
    if (replaceMatch) {
      for (const part of replaceMatch[1].split(/[,，\s]+/)) {
        const index = Number(part)
        if (Number.isInteger(index) && index >= 1) replaces.push(index)
      }
      body = body.replace(replaceMatch[0], '').trim()
    }
    const content = body.replace(/\s+/g, ' ').trim().slice(0, MAX_CANDIDATE_CHARACTERS)
    if (content.length < 4 || containsSecretLike(content)) continue
    const scope = pickScope(tokens) ?? (hasWorkspace ? 'workspace' : 'global')
    candidates.push({
      type,
      // 未归属项目的会话没有 workspace 作用域可落，一律收敛到 global。
      scope: scope === 'workspace' && !hasWorkspace ? 'global' : scope,
      content,
      importance: pickImportance(tokens),
      replaces: [...new Set(replaces)]
    })
    if (candidates.length >= MAX_CANDIDATES) break
  }
  return candidates
}
