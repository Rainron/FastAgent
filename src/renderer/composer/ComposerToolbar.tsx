import React from 'react'
import { ArrowUp, ChevronDown, ListEnd, Paperclip, Pause, Play, X } from 'lucide-react'
import { ContextHealth } from '../conversation/ContextHealth'
import { GitBranchTrigger } from '../conversation/GitBranchMenu'
import { nextConversationMode } from '../workspace-actions'
import { WorkspaceMenu } from './WorkspaceMenu'
import { ModelSelector, PermissionSelector } from './ComposerSelectors'
import type { ComposerToolbarProps } from './composer-toolbar-types'

function SquareIcon() { return <span className="square-icon" aria-hidden="true" /> }

export const ComposerToolbar = React.memo(function ComposerToolbar(props: ComposerToolbarProps) {
  const { mode, planMode, onTogglePlanMode, agentAvailable, setMode, model, selectedModelId, models, favoriteModelIds, recentModelIds, onSelectModel, thinkingLevel, onThinkingLevelChange, onToggleFavorite, permission, permissionProfiles, onPermissionChange, onOpenPermissionSettings, runId, paused, onPause, onResume, onCancel, contextHealth, contextPolicy, compaction, onCompact, onCancelCompaction, onOpenCompactionHistory, onManageModels, workspace, onRevealWorkspace, onCopyWorkspacePath, onChangeWorkspace, onOpenWorkspaceTerminal, workspaceTrust, onToggleWorkspaceTrust, gitState, gitAnyRunActive, onGitCheckout, onGitCreate, onGitStopAndCheckout, onOpenGitPanel, layout, pickerOpen, setPickerOpen, hasDraft, canSend, onAttach, onClear, onSubmit } = props
  const modeLabel = mode === 'chat' ? 'Chat' : 'Agent'
  const compacting = compaction?.status === 'running'
  const compactingManually = compacting && !compaction?.auto
  return (
    <div className={`composer-toolbar ${layout.rows === 2 ? 'two-rows' : 'single-row'} density-${layout.density}`}>
      <span className="composer-font-probe" aria-hidden="true" />
      <div className="composer-toolbar-context">
      <button className="toolbar-icon" onClick={onAttach} aria-label="添加附件" title="添加附件"><Paperclip size={16} /></button>
      {/* 这一轮落在哪个项目、哪个分支：和右侧的运行配置对称，左边是「在哪做」，右边是「怎么做」 */}
      {workspace && <WorkspaceMenu name={workspace.name} path={workspace.path} compact={layout.iconContext} onReveal={onRevealWorkspace} onCopyPath={onCopyWorkspacePath} onChangeFolder={onChangeWorkspace} onOpenTerminal={onOpenWorkspaceTerminal} trust={workspaceTrust} onToggleTrust={onToggleWorkspaceTrust} />}
      {gitState && <GitBranchTrigger state={gitState} compact={layout.iconContext} anyRunActive={gitAnyRunActive} onCheckout={onGitCheckout} onCreate={onGitCreate} onStopAndCheckout={onGitStopAndCheckout} onOpenPanel={onOpenGitPanel} />}
      {planMode && <button className="composer-chip plan-chip" onClick={onTogglePlanMode} title="计划模式已开启：只产出实施计划，Shift+Tab 或点击退出">Plan</button>}
      <ContextHealth data={contextHealth} policy={contextPolicy} onCompact={onCompact} onCancelCompaction={onCancelCompaction} onOpenHistory={onOpenCompactionHistory} compaction={compaction} />
      {hasDraft && <button className="toolbar-icon composer-clear" onClick={onClear} aria-label="清除输入" title="清除输入"><X size={16} /></button>}
      </div>
      <div className="toolbar-spacer" />
      <div className="composer-toolbar-controls">
      <button className="composer-chip mode-chip" onClick={() => agentAvailable && setMode(nextConversationMode(mode))} disabled={!agentAvailable} title={agentAvailable ? `当前模式：${modeLabel}` : '快速对话仅支持 Chat，项目会话可用 Agent'}><span className={`mode-mark ${mode}`} /><span className="mode-chip-label">{modeLabel}</span><ChevronDown size={13} /></button>
      {permission && <PermissionSelector value={permission} profiles={permissionProfiles} onChange={onPermissionChange} density={layout.overflow ? 'compact' : layout.density} onOpenAdvanced={onOpenPermissionSettings} />}
      <ModelSelector thinkingLevel={thinkingLevel} onThinkingLevelChange={onThinkingLevelChange} model={model} models={models} selectedModelId={selectedModelId} favoriteModelIds={favoriteModelIds} recentModelIds={recentModelIds} open={pickerOpen} onOpenChange={setPickerOpen} onSelectModel={onSelectModel} onToggleFavorite={onToggleFavorite} onManageModels={onManageModels} />
      </div>
      <div className="composer-toolbar-actions">
      {runId ? <>
        {canSend && <button className="send-button queue" disabled={compacting} onClick={onSubmit} aria-label="插入当前任务" title="插入当前任务：下一步开始前生效"><ListEnd size={16} /></button>}
        {paused
          ? <button className="send-button" onClick={onResume} aria-label="继续执行" title="继续执行"><Play size={15} /></button>
          : <button className="send-button pause" onClick={onPause} disabled={compactingManually} aria-label="暂停" title="暂停：当前这一步跑完后停在下一次工具调用前"><Pause size={15} /></button>}
        <button className="send-button stop" onClick={onCancel} disabled={compactingManually} aria-label="停止生成" title="停止生成"><SquareIcon /></button>
      </> : <button className="send-button" onClick={onSubmit} disabled={!canSend || compacting} aria-label="发送" title="发送"><ArrowUp size={16} /></button>}
      </div>
    </div>
  )
})
