import { describe, expect, it } from 'vitest'
import { isNewConversationShortcut, nextConversationMode, nextModelId, pushNavigation, stepNavigation } from './workspace-actions'
import * as workspaceActions from './workspace-actions'

describe('workspace actions', () => {
  it('toggles between the two conversation modes', () => {
    expect(nextConversationMode('chat')).toBe('agent')
    expect(nextConversationMode('agent')).toBe('chat')
  })

  it('cycles through available models', () => {
    expect(nextModelId(2, [{ id: 1 }, { id: 2 }, { id: 3 }])).toBe(3)
    expect(nextModelId(3, [{ id: 1 }, { id: 2 }, { id: 3 }])).toBe(1)
    expect(nextModelId(null, [{ id: 1 }, { id: 2 }])).toBe(1)
  })

  it('recognizes the new conversation keyboard shortcut', () => {
    expect(isNewConversationShortcut({ key: 'n', ctrlKey: true, metaKey: false })).toBe(true)
    expect(isNewConversationShortcut({ key: 'N', ctrlKey: false, metaKey: true })).toBe(true)
    expect(isNewConversationShortcut({ key: 'n', ctrlKey: false, metaKey: false })).toBe(false)
  })

  it('pushes a new destination after the current history entry', () => {
    expect(pushNavigation(['chats', 'projects'], 1, 'settings')).toEqual({ entries: ['chats', 'projects', 'settings'], index: 2 })
    expect(pushNavigation(['chats', 'projects'], 1, 'projects')).toEqual({ entries: ['chats', 'projects'], index: 1 })
  })

  it('steps backward and forward within navigation history', () => {
    expect(stepNavigation(['chats', 'projects', 'settings'], 1, -1)).toEqual({ index: 0, target: 'chats' })
    expect(stepNavigation(['chats', 'projects', 'settings'], 1, 1)).toEqual({ index: 2, target: 'settings' })
    expect(stepNavigation(['chats', 'projects', 'settings'], 0, -1)).toBeNull()
  })

  it('继续执行使用短续作提示，不重放原始任务', () => {
    const actions = workspaceActions as unknown as {
      isContinuationInput?: (text: string) => boolean
      buildContinuationPrompt?: (input?: string) => string
    }
    expect(typeof actions.isContinuationInput).toBe('function')
    expect(typeof actions.buildContinuationPrompt).toBe('function')
    if (!actions.isContinuationInput || !actions.buildContinuationPrompt) return
    expect(actions.isContinuationInput('继续执行')).toBe(true)
    expect(actions.isContinuationInput('新的问题')).toBe(false)
    const prompt = actions.buildContinuationPrompt('继续执行，先跑测试')
    expect(prompt).toContain('先跑测试')
    expect(prompt).toContain('不要重做已完成步骤')
    expect(prompt).not.toContain('原始任务全文')
  })
})
