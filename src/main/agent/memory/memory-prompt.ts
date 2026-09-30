import type { MemoryRecallHit, MemoryType } from '../../../shared/types'

/** 注入片段的字符预算：记忆是辅助信息，不该挤占本轮任务描述。 */
export const MEMORY_PROMPT_BUDGET = 1_200

const TYPE_LABEL: Record<MemoryType, string> = {
  preference: '偏好',
  fact: '事实',
  decision: '决定',
  experience: '经验'
}

/**
 * 记忆来自历史会话，没有强一致保证：必须显式告诉模型它的可信级别低于当前输入，
 * 否则用户当场改口时模型会拿旧记忆顶回去。
 */
const HEADER = '## 已知的长期记忆（来自历史会话，可能已过时；与本轮输入冲突时以本轮输入为准）'

export function renderMemoryPrompt(hits: readonly MemoryRecallHit[], budget = MEMORY_PROMPT_BUDGET): string {
  if (!hits.length) return ''
  const lines: string[] = []
  let used = HEADER.length
  for (const hit of hits) {
    const line = `- [${TYPE_LABEL[hit.memory.type]}] ${hit.memory.content.replace(/\s+/g, ' ').trim()}`
    if (used + line.length + 1 > budget) break
    used += line.length + 1
    lines.push(line)
  }
  if (!lines.length) return ''
  return `${HEADER}\n${lines.join('\n')}`
}

/** 注入片段拼在本轮用户输入之前；不进 system prompt，避免击穿会话运行时缓存的 signature。 */
export function withMemoryPrompt(prompt: string, memoryPrompt: string): string {
  return memoryPrompt ? `${memoryPrompt}\n\n${prompt}` : prompt
}

/** 项目知识库注入：人工策展内容，可信度高于记忆，单独成段。 */
export const KB_PROMPT_BUDGET = 2_400

/** 来源标注：有文件与定位时一并给出，模型引用这段内容时才能落回原文的具体位置。 */
function citationOf(entry: { sourcePath?: string | null; locator?: string | null }): string {
  if (!entry.sourcePath) return ''
  return entry.locator ? `（${entry.sourcePath} ${entry.locator}）` : `（${entry.sourcePath}）`
}

export function renderKbPrompt(entries: ReadonlyArray<{ title: string; content: string; sourcePath?: string | null; locator?: string | null }>, budget = KB_PROMPT_BUDGET): string {
  if (!entries.length) return ''
  const lines: string[] = []
  let used = 0
  for (const entry of entries) {
    // 知识条目可能整段粘贴，先压平再拼行；预算按条截断，不截半句。
    const body = entry.content.replace(/\s+/g, ' ').trim()
    const line = `- ${entry.title.replace(/\s+/g, ' ').trim()}${citationOf(entry)}: ${body}`
    if (used + line.length + 1 > budget) break
    used += line.length + 1
    lines.push(line)
  }
  if (!lines.length) return ''
  return [
    '## 项目知识库（人工维护的项目约定与背景）',
    '引用其中内容时，请一并给出括号里的文件与位置。',
    ...lines
  ].join('\n')
}
