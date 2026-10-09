import type { WorkspaceProject } from './workspace-types'

/**
 * 「最近对话」加号的文案：没选项目时建的是快速对话，选了项目就落在那个项目下。
 * 两种形态点的是同一个回调（startNewChatInContext），差别只在提示文案。
 */
export function newChatActionLabel(projects: WorkspaceProject[], selectedProjectId: string | null): string {
  if (!selectedProjectId) return '新建快速对话'
  const project = projects.find((item) => item.id === selectedProjectId)
  return project ? `在 ${project.name} 下新建对话` : '新建快速对话'
}
