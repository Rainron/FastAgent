export type ArchivableWorkspaceItem = { id: string; archived: boolean }

export function upsertRecentWorkspaceItem<T extends ArchivableWorkspaceItem>(items: T[], item: T): T[] {
  return [item, ...items.filter((current) => current.id !== item.id)]
}

export function archiveWorkspaceItem<T extends ArchivableWorkspaceItem>(items: T[], id: string): T[] {
  return items.map((item) => item.id === id ? { ...item, archived: true } : item)
}

export function removeWorkspaceItem<T extends ArchivableWorkspaceItem>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id)
}

/** 重命名不改排序：侧栏按最近活跃排，改个标题不该把会话顶到最前。 */
export function renameWorkspaceItem<T extends { id: string; title: string }>(items: T[], id: string, title: string): T[] {
  return items.map((item) => item.id === id ? { ...item, title } : item)
}

/** 'all' 看全部，'unassigned' 只看不归属任何项目的「快速对话」，其余按 projectId 精确匹配。 */
export type ConversationScope = 'all' | 'unassigned' | (string & {})

export type ScopedConversation = { title: string; projectId: string | null; archived: boolean }

export function filterConversations<T extends ScopedConversation>(items: T[], options: { scope: ConversationScope; query?: string; includeArchived?: boolean }): T[] {
  const keyword = (options.query ?? '').trim().toLowerCase()
  return items.filter((item) => {
    if (!options.includeArchived && item.archived) return false
    if (options.scope === 'unassigned' && item.projectId !== null) return false
    if (options.scope !== 'all' && options.scope !== 'unassigned' && item.projectId !== options.scope) return false
    return !keyword || item.title.toLowerCase().includes(keyword)
  })
}

export function toggleBatchSelection(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** 全选只对当前页可见项生效，跨页已选项保持不变。 */
export function toggleBatchPageSelection(selected: Set<string>, ids: string[]): Set<string> {
  const next = new Set(selected)
  const selectedOnPage = ids.length > 0 && ids.every((id) => next.has(id))
  ids.forEach((id) => selectedOnPage ? next.delete(id) : next.add(id))
  return next
}
