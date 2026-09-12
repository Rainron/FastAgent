import { useState } from 'react'
import { CircleCheck, LoaderCircle, Package } from 'lucide-react'
import type { HubInstalledAbility, HubListing, HubListingContent } from '../../../../shared/types'
import { CapabilityDrawer } from '../../abilities/components/CapabilityDrawer'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { useAsyncActions } from '../../abilities/hooks/useAsyncAction'
import { PluginConfigForm } from '../../plugins/components/PluginConfigForm'
import { PluginPermissionNotice } from '../../plugins/components/PluginPermissionNotice'
import { missingRequiredFields } from '../../plugins/plugin-view'
import { TYPE_LABELS } from '../../abilities/ability-view'
import { abilitiesService } from '../../abilities/services/abilities-service'
import { hubService } from '../services/hub-service'

type Phase = 'review' | 'done'

/**
 * 一条目录项可能带多个能力，安装前把它们逐条列出来。
 * 与其它安装路径一致：装完一律停用，启用是另一个动作。
 */
export function HubInstallDialog({ listing, contents, sourceName, onClose, onInstalled, onOpenAbility }: {
  listing: HubListing
  /** 详情里解析出的子能力清单；还没取到详情时为空数组 */
  contents: HubListingContent[]
  sourceName: string
  onClose: () => void
  onInstalled: () => void
  onOpenAbility: (abilityId: string) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [phase, setPhase] = useState<Phase>('review')
  const [installed, setInstalled] = useState<HubInstalledAbility[]>([])
  const actions = useAsyncActions()

  const missing = missingRequiredFields(listing.configFields, values)
  const installing = actions.isPending('install')
  const enabling = actions.isPending('enable')

  async function install() {
    const result = await actions.run('install', () => hubService.install(listing.sourceId, listing.ref, values))
    if (!result) return
    setInstalled(result.installed)
    setPhase('done')
    onInstalled()
  }

  async function enableAll() {
    const ready = installed.filter((item) => item.status !== 'config_required')
    await actions.run('enable', async () => {
      for (const item of ready) await abilitiesService.setEnabled(item.abilityType, item.abilityId, true)
    })
    onInstalled()
  }

  const enableable = installed.filter((item) => item.status !== 'config_required')

  return <CapabilityDrawer
    title={phase === 'done' ? '安装完成' : `安装 ${listing.displayName}`}
    subtitle={phase === 'done' ? '能力已注册到能力库，默认停用' : `${sourceName} · v${listing.version}`}
    onClose={onClose}
    footer={phase === 'done' ? <button className="quick-secondary" onClick={onClose}>完成</button> : <>
      <button className="primary-button" onClick={() => void install()} disabled={installing || missing.length > 0}>
        {installing && <LoaderCircle size={14} className="spin" />}{installing ? '安装中…' : '安装'}
      </button>
      <button className="quick-secondary" onClick={onClose}>取消</button>
    </>}
  >
    {phase === 'review' ? <div className="ability-detail-body">
      <PluginPermissionNotice plugin={listing} />
      {contents.length > 0 && <div className="ability-detail-section">
        <div className="cap-section-heading"><span>将安装以下能力</span><small>{contents.length} 项</small></div>
        <ul className="hub-contents-list">
          {contents.map((item) => <li key={`${item.kind}-${item.name}`}>
            <Package size={13} /><strong>{item.name}</strong><span>{TYPE_LABELS[item.kind]}</span>
            {item.description && <small>{item.description}</small>}
          </li>)}
        </ul>
      </div>}
      {listing.configFields.length > 0 && <div className="ability-detail-section">
        <div className="cap-section-heading"><span>配置要求</span><small>{missing.length ? `${missing.length} 项必填未填写` : '已就绪'}</small></div>
        <PluginConfigForm fields={listing.configFields} values={values} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} />
      </div>}
      {actions.errorOf('install') && <AbilityErrorBlock title="安装失败" message={actions.errorOf('install') as string} />}
      <p className="settings-hint">安装后能力保持停用状态，必须显式启用后 Agent 才能发现。</p>
    </div> : <div className="ability-detail-body">
      <div className="plugin-install-done"><CircleCheck size={18} /><div>
        <strong>已安装 {installed.length} 项能力</strong>
        <span>全部处于停用状态。</span>
      </div></div>
      <ul className="hub-contents-list">
        {installed.map((item) => <li key={`${item.abilityType}-${item.abilityId}`}>
          <strong>{item.abilityId}</strong><span>{TYPE_LABELS[item.abilityType]}</span>
          {item.status === 'config_required' && <small>需要补全配置后才能启用</small>}
          <button className="small-control" onClick={() => onOpenAbility(item.abilityId)}>打开能力</button>
        </li>)}
      </ul>
      {enableable.length > 0 && <div className="ability-empty-actions">
        <button className="quick-secondary" onClick={() => void enableAll()} disabled={enabling}>
          {enabling && <LoaderCircle size={13} className="spin" />}{enabling ? '启用中…' : `启用全部（${enableable.length}）`}
        </button>
      </div>}
      {actions.errorOf('enable') && <AbilityErrorBlock title="启用失败" message={actions.errorOf('enable') as string} />}
    </div>}
  </CapabilityDrawer>
}
