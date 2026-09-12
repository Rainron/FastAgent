export type SidebarSectionKey = 'workspace' | 'recent'

export interface SidebarSectionState {
  workspace: boolean
  recent: boolean
}

export function toggleSidebarSection(state: SidebarSectionState, section: SidebarSectionKey): SidebarSectionState {
  return { ...state, [section]: !state[section] }
}
