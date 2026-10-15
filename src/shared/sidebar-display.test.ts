import { describe, expect, it } from 'vitest'
import { normalizeSidebarDisplay } from './sidebar-display'

describe('sidebar display', () => {
  it('defaults missing old settings independently', () => {
    expect(normalizeSidebarDisplay(undefined)).toEqual({ workspaces: 8, projectConversations: 5, recentConversations: 10 })
    expect(normalizeSidebarDisplay({ workspaces: 12 })).toEqual({ workspaces: 12, projectConversations: 5, recentConversations: 10 })
  })
  it('normalizes invalid, fractional and out of range values', () => {
    expect(normalizeSidebarDisplay({ workspaces: -5, projectConversations: 200, recentConversations: 3.9 })).toEqual({ workspaces: 1, projectConversations: 100, recentConversations: 3 })
    expect(normalizeSidebarDisplay({ workspaces: NaN, recentConversations: '20' })).toEqual({ workspaces: 8, projectConversations: 5, recentConversations: 10 })
  })
})
