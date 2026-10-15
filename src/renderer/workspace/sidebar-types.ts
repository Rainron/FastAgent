import type { AuthSnapshot, ConversationRunState } from '../../shared/types'
import type { SidebarDisplaySettings } from '../../shared/sidebar-display'
import type { CompactionStates } from '../conversation/compaction-state'
import type { SidebarSectionState } from '../sidebar-sections'
import type { WorkspaceConversation, WorkspaceProject, WorkspaceSection } from './workspace-types'

export interface SidebarProps {
  collapsed: boolean
  section: WorkspaceSection
  abilityAlerts: number
  sidebarDisplay?: SidebarDisplaySettings
  projects: WorkspaceProject[]
  conversations: WorkspaceConversation[]
  projectConversationRefreshKey: number
  selectedProjectId: string | null
  selectedConversationId: string | null
  onInspectConversation: (id: string) => void
  onStartBatch: (kind: 'projects' | 'conversations') => void
  onDeleteProject: (id: string) => void
  onArchiveProject: (id: string) => void
  onOpenProjectFolder: (path: string) => void
  onOpenConversationFolder: (id: string) => void
  onDeleteConversation: (id: string) => void
  onArchiveConversation: (id: string) => void
  onRenameConversation: (id: string, title: string) => void
  onExportConversation: (id: string) => void
  onDistillSkill: (id: string) => void
  onNavigate: (section: WorkspaceSection) => void
  onNewChat: () => void
  onNewChatInSection: () => void
  onNewChatInProject: (project: WorkspaceProject) => void
  onToggle: () => void
  onPickWorkspace: () => void
  onSelectConversation: (item: WorkspaceConversation) => void
  onSelectProject: (item: WorkspaceProject) => void
  onAccountAction: () => void
  auth: AuthSnapshot
  onOpenConversations: () => void
  runStates: Record<string, ConversationRunState>
  compactionStates: CompactionStates
  onReadRun: (conversationId: string) => void
  sectionStates: SidebarSectionState
  onToggleSection: (section: keyof SidebarSectionState) => void
  recentTotal: number
  recentLoading: boolean
  recentError: string | null
  onLoadMoreRecent: () => void
  onRetryRecent: () => void
  onSearchRecent: (query: string) => void
}
