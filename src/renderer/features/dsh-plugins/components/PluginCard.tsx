import React from 'react'
import { ExternalLink, LoaderCircle, MoreHorizontal, Puzzle, Trash2 } from 'lucide-react'
import type { DshPluginRecord } from '../../../../shared/types'
import { AbilityStatusBadge } from '../../abilities/components/AbilityStatusBadge'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { AbilityMenu } from '../../abilities/components/AbilityMenu'
import { activationBadge, activationTools, presentActivation } from '../plugin-view'

/** 工具名占位有限，超出的折成一个计数，行高才不会被工具多的插件撑开。 */
const TOOL_PREVIEW = 4

export function DshPluginCard({ plugin, pending, error, onToggle, onUninstall, onOpenHomepage }: {
  plugin: DshPluginRecord
  pending: boolean
  error: string | null
  onToggle: (enabled: boolean) => void
  onUninstall: () => void
  onOpenHomepage: (url: string) => void
}) {
  const status = presentActivation(plugin)
  const tools = activationTools(plugin.activation)
  return <div className="ability-row ability-card">
    <div className="ability-row-main">
      <div className="ability-row-title">
        <span className="cap-row-icon"><Puzzle size={14} /></span>
        <strong>{plugin.displayName}</strong>
        <AbilityStatusBadge status={activationBadge(plugin)} />
      </div>
      <small>{plugin.description}</small>
      <div className="ability-row-meta">
        <span className="mono">{plugin.name}</span>
        <span>v{plugin.version}</span>
        {plugin.author && <span>{plugin.author}</span>}
        {tools.length > 0 && <>
          {tools.slice(0, TOOL_PREVIEW).map((tool) => <span className="mono" key={tool}>{tool}</span>)}
          {tools.length > TOOL_PREVIEW && <span>+{tools.length - TOOL_PREVIEW}</span>}
        </>}
      </div>
      {status.detail && status.tone === 'warn' && <div className="cap-warn-block">
        <div><strong>{status.label}</strong><span>{status.detail}</span></div>
      </div>}
      {status.detail && status.tone === 'error' && <AbilityErrorBlock title={status.label} message={status.detail} />}
      {error && <AbilityErrorBlock message={error} />}
    </div>
    <div className="ability-row-actions">
      <label className="switch-row" title="启用后插件会挂载到宿主并向对话提供工具">
        <input type="checkbox" checked={plugin.enabled} disabled={pending} onChange={(event) => onToggle(event.target.checked)} />
        <span className="switch-visual" />
        <span>{pending ? <LoaderCircle size={12} className="spin" /> : plugin.enabled ? '已启用' : '已停用'}</span>
      </label>
      <AbilityMenu
        label={`${plugin.displayName} 的更多操作`}
        trigger={<MoreHorizontal size={15} />}
        items={[
          ...(plugin.homepage ? [{ key: 'homepage', label: '打开主页', icon: <ExternalLink size={13} />, onSelect: () => onOpenHomepage(plugin.homepage as string) }] : []),
          { key: 'uninstall', label: '卸载', icon: <Trash2 size={13} />, danger: true, disabled: pending, onSelect: onUninstall }
        ]}
      />
    </div>
  </div>
}

export const MemoDshPluginCard = React.memo(DshPluginCard)
