import { useState } from 'react'
import { LoaderCircle, Package } from 'lucide-react'
import type { HubListing, HubListingDetail } from '../../../../shared/types'
import { CapabilityDrawer } from '../../abilities/components/CapabilityDrawer'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { useAsyncActions } from '../../abilities/hooks/useAsyncAction'
import { PluginPermissionNotice } from '../../plugins/components/PluginPermissionNotice'
import { primaryAction, pluginStatus } from '../../plugins/plugin-view'
import { TYPE_LABELS } from '../../abilities/ability-view'
import { pluginsService } from '../../plugins/services/plugins-service'

const TARGET_LABELS: Record<string, string> = { env: '环境变量', header: '请求头', url: '服务地址', command: '启动命令', cwd: '工作目录', args: '启动参数' }

/**
 * 目录条目详情。装与不装的信息在同一个抽屉里看全：README、子能力清单、权限告示、配置要求。
 * 主按钮只负责关掉自己并把安装意图交回列表页，避免抽屉上再叠一层抽屉。
 */
export function HubDetailDrawer({ listing, detail, sourceName, loading, error, onClose, onPrimary, onOpenAbility, onUninstalled, onNotice }: {
  listing: HubListing
  /** 取详情失败时为 null，此时用搜索结果那份渲染，README 与子能力缺省 */
  detail: HubListingDetail | null
  sourceName: string
  loading: boolean
  error: string | null
  onClose: () => void
  onPrimary: () => void
  onOpenAbility: (abilityId: string) => void
  onUninstalled: () => void
  onNotice: (notice: string) => void
}) {
  // 卸载会删掉本地 Skill 目录 / MCP Server 配置，必须二次确认。
  const [confirming, setConfirming] = useState(false)
  const actions = useAsyncActions()
  const item = detail ?? listing
  const action = primaryAction(item, pluginStatus(item))
  const uninstalling = actions.isPending('uninstall')

  async function uninstall() {
    const done = await actions.run('uninstall', async () => { await pluginsService.uninstall(listing.id); return true })
    if (!done) return
    onNotice(`已卸载 ${item.displayName}`)
    setConfirming(false)
    onUninstalled()
    onClose()
  }

  return <CapabilityDrawer
    title={item.displayName}
    subtitle={`${sourceName} · v${item.version}`}
    onClose={onClose}
    footer={<>
      <button className="primary-button" onClick={() => { if (action.kind === 'open' && item.abilityId) { onOpenAbility(item.abilityId) } else { onPrimary() } }} disabled={action.disabled}>
        {action.label}
      </button>
      {item.installed && <button className="small-control danger" onClick={() => setConfirming(true)} disabled={uninstalling}>
        {uninstalling && <LoaderCircle size={13} className="spin" />}卸载
      </button>}
      <button className="quick-secondary" onClick={onClose}>取消</button>
    </>}
  >
    <div className="ability-detail-body">
      <div className="ability-detail-section">
        <div className="cap-section-heading"><span>基本信息</span></div>
        <dl className="ability-meta-list">
          <div><dt>类型</dt><dd>{TYPE_LABELS[item.abilityType]}</dd></div>
          <div><dt>作者</dt><dd>{item.author ?? '未标注'}</dd></div>
          <div><dt>来源</dt><dd>{sourceName}</dd></div>
          <div><dt>分类</dt><dd>{item.categories.length ? item.categories.join('、') : '未分类'}</dd></div>
          {item.installedVersion && <div><dt>已安装版本</dt><dd>v{item.installedVersion}</dd></div>}
          <div><dt>Repository</dt><dd className="mono">{item.repository ?? '无'}</dd></div>
          <div><dt>主页</dt><dd className="mono">{item.homepage ?? '无'}</dd></div>
        </dl>
      </div>

      {error && <AbilityErrorBlock title="详情加载失败" message={`${error}（下面只显示搜索结果里的信息）`} />}

      <div className="ability-detail-section">
        <div className="cap-section-heading"><span>README</span></div>
        {loading ? <p className="settings-hint"><LoaderCircle size={13} className="spin" /> 加载中…</p>
          : detail?.readme ? <pre className="ability-code-block">{detail.readme}</pre>
          : <p className="settings-hint">该条目没有提供 README。</p>}
      </div>

      {detail && detail.contents.length > 0 && <div className="ability-detail-section">
        <div className="cap-section-heading"><span>将安装以下能力</span><small>{detail.contents.length} 项</small></div>
        <ul className="hub-contents-list">
          {detail.contents.map((content) => <li key={`${content.kind}-${content.name}`}>
            <Package size={13} /><strong>{content.name}</strong><span>{TYPE_LABELS[content.kind]}</span>
            {content.description && <small>{content.description}</small>}
          </li>)}
        </ul>
      </div>}

      <PluginPermissionNotice plugin={item} />

      {item.configFields.length > 0 && <div className="ability-detail-section">
        <div className="cap-section-heading"><span>配置要求</span><small>{item.configFields.length} 项</small></div>
        <ul className="hub-contents-list">
          {item.configFields.map((field) => <li key={field.key}>
            <strong>{field.label}</strong>
            <span>{TARGET_LABELS[field.target] ?? field.target}</span>
            {field.required && <span>必填</span>}
            {field.secret && <span>密钥</span>}
          </li>)}
        </ul>
      </div>}

      {confirming && <div className="ability-detail-section">
        <AbilityErrorBlock
          title={`确认卸载 ${item.displayName}？`}
          message="卸载会删除本地已安装的 Skill 目录与 MCP Server 配置，无法撤销。已填写的密钥同样会被清除。"
          actions={<>
            <button className="small-control danger" onClick={() => void uninstall()} disabled={uninstalling}>确认卸载</button>
            <button className="small-control" onClick={() => setConfirming(false)} disabled={uninstalling}>取消</button>
          </>}
        />
      </div>}
      {actions.errorOf('uninstall') && <AbilityErrorBlock title="卸载失败" message={actions.errorOf('uninstall') as string} />}
    </div>
  </CapabilityDrawer>
}
