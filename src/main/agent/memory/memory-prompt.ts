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
