import type { WorkspaceConversation, WorkspaceProject } from './workspace-types'

/** 空关键词直接返回原数组，保持引用不变，避免穿透 Sidebar 下游的 memo。 */
function normalize(keyword: string): string {
  return keyword.trim().toLowerCase()
}

/** 项目按目录名匹配；路径一并参与，和主进程 listProjectsPage 的 keyword 行为保持一致。 */
export function filterProjects(projects: WorkspaceProject[], keyword: string): WorkspaceProject[] {
  const needle = normalize(keyword)
  if (!needle) return projects
  return projects.filter((project) => project.name.toLowerCase().includes(needle) || project.path.toLowerCase().includes(needle))
}

export function filterConversations(conversations: WorkspaceConversation[], keyword: string): WorkspaceConversation[] {
  const needle = normalize(keyword)
  if (!needle) return conversations
  return conversations.filter((conversation) => conversation.title.toLowerCase().includes(needle))
}
