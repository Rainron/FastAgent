import { describe, expect, it } from 'vitest'
import { filterConversations, filterProjects } from './sidebar-filter'
import type { WorkspaceConversation, WorkspaceProject } from './workspace-types'

function project(id: string, name: string, path: string): WorkspaceProject {
  return { id, name, path, color: 'calm', archived: false, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }
}

function conversation(id: string, title: string): WorkspaceConversation {
  return { id, title, meta: '刚刚', archived: false, projectId: null, modelId: null }
}

describe('filterProjects', () => {
  const projects = [project('p1', 'fastagent-desktop', 'K:/cc-project/fastagent-desktop'), project('p2', 'Sandbox', 'K:/cc-project/sandbox')]

  it('空关键词返回原数组引用', () => {
    expect(filterProjects(projects, '   ')).toBe(projects)
  })

  it('按目录名不区分大小写匹配', () => {
    expect(filterProjects(projects, 'SANDBOX').map((item) => item.id)).toEqual(['p2'])
  })

  it('路径片段也能命中', () => {
    expect(filterProjects(projects, 'cc-project').map((item) => item.id)).toEqual(['p1', 'p2'])
  })

  it('无命中返回空数组', () => {
    expect(filterProjects(projects, 'nope')).toEqual([])
  })
})

describe('filterConversations', () => {
  const conversations = [conversation('c1', '重构侧栏'), conversation('c2', 'Runtime 打包')]

  it('空关键词返回原数组引用', () => {
    expect(filterConversations(conversations, '')).toBe(conversations)
  })

  it('按标题不区分大小写匹配', () => {
    expect(filterConversations(conversations, 'runtime').map((item) => item.id)).toEqual(['c2'])
  })
})
