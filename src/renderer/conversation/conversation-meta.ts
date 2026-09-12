import type { ConversationRecord, ConversationTurn } from '../../shared/types'
import type { WorkspaceConversation } from '../workspace/workspace-types'

export function titleFromPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  return normalized.length > 36 ? `${normalized.slice(0, 36)}…` : normalized || '新对话'
}

/** 手动重命名的标题上限，与自动生成的 titleFromPrompt 对齐，避免侧栏被一行长标题撑开。 */
export const CONVERSATION_TITLE_MAX = 36

/** 归一化重命名输入；返回 null 表示这次改名不作数（全空白或与原标题相同）。 */
export function normalizeRenameInput(input: string, current: string): string | null {
  const normalized = input.replace(/\s+/g, ' ').trim().slice(0, CONVERSATION_TITLE_MAX)
  if (!normalized || normalized === current) return null
  return normalized
}

export function conversationMetaNow(now = new Date()) {
  return `今天 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

export function conversationMetaFromTimestamp(timestamp: string) {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return conversationMetaNow()
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function toWorkspaceConversation(record: ConversationRecord): WorkspaceConversation {
  return { id: record.id, title: record.title, meta: conversationMetaFromTimestamp(record.updatedAt), archived: record.archived, projectId: record.projectId, modelId: record.modelId }
}

/**
 * 切走会话时流式文本只活在渲染进程内存里，重新载入历史后要贴回去，
 * 否则「进行中切走再切回」看起来就是回答凭空消失。DB 里的更长时以 DB 为准。
 */
export function mergeStreamedText(turns: ConversationTurn[], streamed: ReadonlyMap<string, string>): ConversationTurn[] {
  if (!streamed.size) return turns
  return turns.map((turn) => {
    const text = streamed.get(turn.id)
    if (!text || (turn.assistantMessage?.text.length ?? 0) >= text.length) return turn
    return { ...turn, assistantMessage: { text, createdAt: turn.assistantMessage?.createdAt || turn.createdAt } }
  })
}

/** 读取旧版存在 localStorage 里的模型 id 列表，损坏时按空列表处理。 */
export function readModelIds(key: string): number[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : []
  } catch {
    return []
  }
}
