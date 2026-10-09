import { describe, expect, it } from 'vitest'
import type { WorkspaceProject } from './workspace-types'
import { newChatActionLabel } from './sidebar-actions'

function project(patch: Partial<WorkspaceProject> = {}): WorkspaceProject {
  return {
    id: 'p1', name: 'fastagent-desktop', path: 'K:/cc-project/fastagent-desktop', color: 'calm',
    archived: false, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', ...patch
  }
}

describe('newChatActionLabel', () => {
  it('没有选中项目时是快速对话', () => {
    expect(newChatActionLabel([project()], null)).toBe('新建快速对话')
  })

  it('选中项目时带上项目名', () => {
    expect(newChatActionLabel([project()], 'p1')).toBe('在 fastagent-desktop 下新建对话')
  })

  it('选中的项目已经不在列表里时退回快速对话', () => {
    expect(newChatActionLabel([project()], 'gone')).toBe('新建快速对话')
  })
})
