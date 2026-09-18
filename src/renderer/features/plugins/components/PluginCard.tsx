import { BookOpen, ClipboardCheck, Download, FileText, FolderOpen, Github, LoaderCircle, Package, Palette, Plug, Wrench } from 'lucide-react'
import { AbilityStatusBadge } from '../../abilities/components/AbilityStatusBadge'
import { TYPE_LABELS } from '../../abilities/ability-view'
import { pluginStatus, pluginStatusPresentation, primaryAction, type CatalogItem } from '../plugin-view'

// 显式登记而不是 import * as icons：命名空间导入会让整套 lucide 图标进包。
const PLUGIN_ICONS: Record<string, typeof Package> = {
  BookOpen, ClipboardCheck, FileText, FolderOpen, Github, Package, Palette, Plug, Wrench
}

/** catalog 只给 lucide 图标名，避免引入外部图片资源。 */
function PluginIcon({ name }: { name?: string }) {
  const Icon = (name && PLUGIN_ICONS[name]) || Package
  return <span className="plugin-card-icon"><Icon size={17} /></span>
}

export function PluginCard({ plugin, pending, onOpen, onPrimary }: {
  plugin: CatalogItem
  pending?: 'installing' | 'uninstalling'
  onOpen: () => void
  onPrimary: () => void
}) {
  const status = pluginStatus(plugin, pending)
  const action = primaryAction(plugin, status)

  return <div className="plugin-card">
    <PluginIcon name={plugin.icon} />
    <div className="plugin-card-main" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onOpen() }}>
      <div className="plugin-card-title">
        <strong>{plugin.displayName}</strong>
        <AbilityStatusBadge status={pluginStatusPresentation(status)} />
      </div>
      <small>{plugin.description || '暂无简介'}</small>
      <div className="ability-row-meta">
        <span>{TYPE_LABELS[plugin.abilityType]}</span>
        {plugin.author && <span>{plugin.author}</span>}
        {plugin.version && <span>v{plugin.version}</span>}
        {plugin.downloadCount !== undefined && <span><Download size={10} /> {plugin.downloadCount}</span>}
        {plugin.categories.map((category) => <span key={category}>{category}</span>)}
      </div>
    </div>
    <div className="plugin-card-actions">
      <button className={action.kind === 'open' ? 'quick-secondary' : 'primary-button'} onClick={onPrimary} disabled={action.disabled}>
        {pending && <LoaderCircle size={13} className="spin" />}{action.label}
      </button>
      <button className="small-control" onClick={onOpen}>详情</button>
    </div>
  </div>
}
