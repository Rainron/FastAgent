import type { SearchQuery, SearchResponse } from '../../shared/types'
import { makeSnippet, runUnifiedSearch } from '../search/unified-search'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 统一搜索：会话标题、项目知识、Skill、成果各查一次再合并。 */
export function registerSearchIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('search:query', (_event, query: SearchQuery): SearchResponse => {
    const namespace = ctx.requireNamespace()
    return runUnifiedSearch(query, {
      conversation: ({ keyword, projectId, limit }) => ctx.store.searchConversationsByTitle(namespace, keyword, projectId, limit)
        .map((record) => ({
          kind: 'conversation' as const,
          id: record.id,
          title: record.title,
          snippet: '',
          projectId: record.projectId,
          locator: null,
          updatedAt: Date.parse(record.updatedAt) || 0
        })),
      knowledge: ({ keyword, projectId, limit }) => ctx.store.knowledgeBase.searchByKeyword(namespace, projectId, keyword, limit)
        .map((entry) => ({
          kind: 'knowledge' as const,
          id: entry.id,
          title: entry.title,
          snippet: makeSnippet(entry.content, keyword),
          projectId: entry.projectId,
          locator: entry.sourcePath ? `${entry.sourcePath}${entry.locator ? ` ${entry.locator}` : ''}` : null,
          updatedAt: entry.updatedAt
        })),
      skill: ({ keyword, limit }) => {
        const lowered = keyword.toLowerCase()
        return ctx.skillRegistry.list()
          .filter((skill) => skill.name.toLowerCase().includes(lowered) || skill.description.toLowerCase().includes(lowered))
          .slice(0, limit)
          .map((skill) => ({
            kind: 'skill' as const,
            id: skill.name,
            title: skill.name,
            snippet: makeSnippet(skill.description, keyword),
            projectId: null,
            locator: skill.filePath,
            updatedAt: 0
          }))
      },
      artifact: ({ keyword, projectId, limit }) => {
        // 产物按工作区隔离；按项目过滤时用项目路径当 workspaceId。
        const workspaceId = projectId ? ctx.store.listProjects(namespace).find((project) => project.id === projectId)?.path : undefined
        if (projectId && !workspaceId) return []
        return ctx.store.listArtifacts(namespace, { keyword, workspaceId, limit })
          .map((artifact) => ({
            kind: 'artifact' as const,
            id: artifact.id,
            title: artifact.name,
            snippet: artifact.path ?? '',
            projectId: projectId ?? null,
            locator: artifact.path ?? null,
            workspaceId: artifact.workspaceId,
            updatedAt: artifact.updatedAt
          }))
      }
    })
  })
}
