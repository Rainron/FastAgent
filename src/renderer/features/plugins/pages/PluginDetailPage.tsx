import { useState } from 'react'
import { ArrowLeft, LoaderCircle, Trash2 } from 'lucide-react'
import type { Plugin } from '../../../../shared/types'
import { AbilityStatusBadge } from '../../abilities/components/AbilityStatusBadge'
import { AbilityEmptyState } from '../../abilities/components/AbilityEmptyState'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { TYPE_LABELS } from '../../abilities/ability-view'
import { useAsyncActions } from '../../abilities/hooks/useAsyncAction'
import { PluginPermissionNotice } from '../components/PluginPermissionNotice'
import { pluginStatus, pluginStatusPresentation, primaryAction } from '../plugin-view'
import { pluginsService } from '../services/plugins-service'

type DetailTab = 'overview' | 'readme' | 'ability' | 'config' | 'permissions' | 'changelog'

const TABS: Array<[DetailTab, string]> = [
  ['overview', '概览'],
  ['readme', 'README'],
  ['ability', '能力说明'],
  ['config', '配置要求'],
  ['permissions', '权限'],
  ['changelog', '更新记录']
]

export function PluginDetailPage({ plugin, onBack, onInstall, onOpenAbility, onChanged, onNotice }: {
  plugin: Plugin
  onBack: () => void
  onInstall: () => void
  onOpenAbility: (abilityId: string) => void
  onChanged: () => void
  onNotice: (notice: string) => void
}) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const actions = useAsyncActions()
  const uninstalling = actions.isPending('uninstall')
  const status = pluginStatus(plugin, uninstalling ? 'uninstalling' : undefined)
  const action = primaryAction(plugin, status)

  async function uninstall() {
    await actions.run('uninstall', async () => {
      await pluginsService.uninstall(plugin.id)
      onNotice(`已卸载插件：${plugin.displayName}`)
    })
    onChanged()
  }

  return <div className="plugins-page">
    <div className="capabilities-header">
      <div>
        <button className="small-control" onClick={onBack}><ArrowLeft size={13} />返回插件市场</button>
        <h1>{plugin.displayName}</h1>
        <p>{plugin.description}</p>
        <div className="ability-row-meta">
          <AbilityStatusBadge status={pluginStatusPresentation(status)} />
          <span>{TYPE_LABELS[plugin.abilityType]}</span>
          <span>{plugin.author ?? '未标注作者'}</span>
          <span>v{plugin.version}</span>
          <span>发布于 {new Date(plugin.publishedAt).toLocaleDateString()}</span>
          {plugin.downloadCount !== undefined && <span>{plugin.downloadCount} 次安装</span>}
        </div>
      </div>
      <div className="capabilities-actions">
        <button
          className={action.kind === 'open' ? 'quick-secondary' : 'primary-button'}
          disabled={action.disabled}
          onClick={() => (action.kind === 'open' && plugin.abilityId ? onOpenAbility(plugin.abilityId) : onInstall())}
        >{action.label}</button>
        {plugin.installed && <button className="quick-secondary" onClick={() => void uninstall()} disabled={uninstalling}>
          {uninstalling ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}{uninstalling ? '卸载中…' : '卸载'}
        </button>}
      </div>
    </div>

    <nav className="capabilities-tabs" role="tablist" aria-label="插件详情">
      {TABS.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
      ))}
    </nav>

    <div className="capabilities-content">
      {actions.errorOf('uninstall') && <AbilityErrorBlock title="卸载失败" message={actions.errorOf('uninstall') as string} />}
      {tab === 'overview' && <dl className="ability-meta-list">
        <div><dt>类型</dt><dd>{TYPE_LABELS[plugin.abilityType]}</dd></div>
        <div><dt>标识</dt><dd className="mono">{plugin.id}</dd></div>
        <div><dt>分类</dt><dd>{plugin.categories.join('、') || '未分类'}</dd></div>
        <div><dt>标签</dt><dd>{plugin.tags.join('、') || '无'}</dd></div>
        <div><dt>已安装版本</dt><dd>{plugin.installedVersion ?? '未安装'}</dd></div>
        <div><dt>主页</dt><dd className="mono">{plugin.homepage ?? '无'}</dd></div>
        <div><dt>Repository</dt><dd className="mono">{plugin.repository ?? '无'}</dd></div>
      </dl>}
      {tab === 'readme' && (plugin.readme
        ? <pre className="ability-code-block">{plugin.readme}</pre>
        : <AbilityEmptyState title="没有 README" description="该插件没有提供说明文档。" />)}
      {tab === 'ability' && <div className="ability-detail-section">
        <p className="settings-hint">
          {plugin.abilityType === 'skill'
            ? '安装后会在 ~/.fa/skills 下生成一个 Skill 目录，包含标准的 SKILL.md；启用后 Agent 会按需加载其中的知识与工作流。'
            : '安装后会注册一个 MCP Server 配置；启用后每轮 Agent 运行时按需建立连接，结束即关闭，其 Tools 会进入 Agent 的可调用工具集。'}
        </p>
        <p className="settings-hint">安装与启用分离：安装完成时能力为停用状态，必须显式启用后 Agent 才可见。</p>
      </div>}
      {tab === 'config' && (plugin.configFields.length ? <div className="ability-file-list">
        {plugin.configFields.map((field) => <div className="ability-file-row" key={field.key}>
          <span className="mono">{field.key}</span>
          <small>{field.label} · {field.target} · {field.required ? '必填' : '可选'}{field.secret ? ' · 密钥' : ''}</small>
        </div>)}
      </div> : <AbilityEmptyState title="无需额外配置" description="该插件安装后即可直接启用。" />)}
      {tab === 'permissions' && <PluginPermissionNotice plugin={plugin} />}
      {tab === 'changelog' && <AbilityEmptyState
        title="暂无更新记录"
        description="内置插件目录随应用发布，版本变化会体现在应用更新说明里。"
      />}
    </div>
  </div>
}
