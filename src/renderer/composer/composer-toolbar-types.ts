import type { ComposerProps } from './composer-types'
import type { composerLayout } from './composer-layout'

export type ComposerToolbarProps = Pick<ComposerProps,
  | 'mode'
  | 'planMode'
  | 'onTogglePlanMode'
  | 'agentAvailable'
  | 'setMode'
  | 'model'
  | 'selectedModelId'
  | 'models'
  | 'favoriteModelIds'
  | 'recentModelIds'
  | 'onSelectModel'
  | 'thinkingLevel'
  | 'onThinkingLevelChange'
  | 'onToggleFavorite'
  | 'permission'
  | 'permissionProfiles'
  | 'onOpenPermissionSettings'
  | 'runId'
  | 'paused'
  | 'onPause'
  | 'onResume'
  | 'onCancel'
  | 'contextHealth'
  | 'contextPolicy'
  | 'compaction'
  | 'onCompact'
  | 'onCancelCompaction'
  | 'onOpenCompactionHistory'
  | 'onManageModels'
  | 'workspace'
  | 'onRevealWorkspace'
  | 'onCopyWorkspacePath'
  | 'onChangeWorkspace'
  | 'onOpenWorkspaceTerminal'
  | 'workspaceTrust'
  | 'onToggleWorkspaceTrust'
  | 'gitState'
  | 'gitAnyRunActive'
  | 'onGitCheckout'
  | 'onGitCreate'
  | 'onGitStopAndCheckout'
  | 'onOpenGitPanel'
  | 'onPermissionChange'
> & {
  layout: ReturnType<typeof composerLayout>
  pickerOpen: boolean
  setPickerOpen: (open: boolean) => void
  hasDraft: boolean
  canSend: boolean
  onAttach: () => void
  onClear: () => void
  onSubmit: () => void
}
