export interface SidebarDisplaySettings {
  workspaces: number
  projectConversations: number
  recentConversations: number
}

export const DEFAULT_SIDEBAR_DISPLAY: SidebarDisplaySettings = {
  workspaces: 8,
  projectConversations: 5,
  recentConversations: 10
}

export const SIDEBAR_DISPLAY_LIMIT = { min: 1, max: 100 } as const

function normalizeCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(SIDEBAR_DISPLAY_LIMIT.max, Math.max(SIDEBAR_DISPLAY_LIMIT.min, Math.floor(value)))
    : fallback
}

export function normalizeSidebarDisplay(value: unknown): SidebarDisplaySettings {
  const input = value && typeof value === 'object' ? value as Partial<SidebarDisplaySettings> : undefined
  return {
    workspaces: normalizeCount(input?.workspaces, DEFAULT_SIDEBAR_DISPLAY.workspaces),
    projectConversations: normalizeCount(input?.projectConversations, DEFAULT_SIDEBAR_DISPLAY.projectConversations),
    recentConversations: normalizeCount(input?.recentConversations, DEFAULT_SIDEBAR_DISPLAY.recentConversations)
  }
}
