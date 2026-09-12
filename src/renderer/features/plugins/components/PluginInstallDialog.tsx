import { useState } from 'react'
import { CircleCheck, LoaderCircle } from 'lucide-react'
import type { McpTestStatus, Plugin, PluginInstallResult } from '../../../../shared/types'
import { CapabilityDrawer } from '../../abilities/components/CapabilityDrawer'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { useAsyncActions } from '../../abilities/hooks/useAsyncAction'
import { PluginConfigForm } from './PluginConfigForm'
import { PluginPermissionNotice } from './PluginPermissionNotice'
import { missingRequiredFields } from '../plugin-view'
import { pluginsService } from '../services/plugins-service'
import { abilitiesService } from '../../abilities/services/abilities-service'
import { mcpService } from '../../mcp/services/mcp-service'

type Phase = 'review' | 'done'

/** 安装流程：确认来源与权限 → （填配置）→ 安装 → 注册能力 →（可选）启用。 */
export function PluginInstallDialog({ plugin, onClose, onInstalled, onOpenAbility }: {
  plugin: Plugin
  onClose: () => void
  onInstalled: () => void
  onOpenAbility: (result: PluginInstallResult) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [phase, setPhase] = useState<Phase>('review')
  const [result, setResult] = useState<PluginInstallResult | null>(null)
  const [testStatus, setTestStatus] = useState<McpTestStatus | null>(null)
  const actions = useAsyncActions()

  const missing = missingRequiredFields(plugin.configFields, values)
  const installing = actions.isPending('install')
  const enabling = actions.isPending('enable')
  const testing = actions.isPending('test')

  async function install() {
    const installed = await actions.run('install', () => pluginsService.install(plugin.id, values))
    if (!installed) return
    setResult(installed)
    setPhase('done')
    onInstalled()
  }

  async function enable() {
    if (!result) return
    await actions.run('enable', () => abilitiesService.setEnabled(result.abilityType, result.abilityId, true))
    onInstalled()
  }

  async function test() {
    if (!result || result.abilityType !== 'mcp') return
    const status = await actions.run('test', () => mcpService.test(result.abilityId))
    if (status) setTestStatus(status)
    onInstalled()
  }

  return <CapabilityDrawer
    title={phase === 'done' ? '安装完成' : `安装 ${plugin.displayName}`}
    subtitle={phase === 'done' ? '能力已注册到能力库，默认停用' : `${plugin.abilityType === 'skill' ? 'Skill' : 'MCP Server'} · v${plugin.version}`}
    onClose={onClose}
    footer={phase === 'done' ? <>
      {result && <button className="primary-button" onClick={() => onOpenAbility(result)}>打开能力</button>}
      <button className="quick-secondary" onClick={onClose}>完成</button>
    </> : <>
      <button className="primary-button" onClick={() => void install()} disabled={installing || missing.length > 0}>
        {installing && <LoaderCircle size={14} className="spin" />}{installing ? '安装中…' : '安装'}
      </button>
      <button className="quick-secondary" onClick={onClose}>取消</button>
    </>}
  >
    {phase === 'review' ? <div className="ability-detail-body">
      <PluginPermissionNotice plugin={plugin} />
      {plugin.configFields.length > 0 && <div className="ability-detail-section">
        <div className="cap-section-heading"><span>配置要求</span><small>{missing.length ? `${missing.length} 项必填未填写` : '已就绪'}</small></div>
        <PluginConfigForm fields={plugin.configFields} values={values} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} />
      </div>}
      {actions.errorOf('install') && <AbilityErrorBlock title="安装失败" message={actions.errorOf('install') as string} />}
      <p className="settings-hint">安装后能力保持停用状态，必须显式启用后 Agent 才能发现。</p>
    </div> : <div className="ability-detail-body">
      <div className="plugin-install-done"><CircleCheck size={18} /><div>
        <strong>{plugin.displayName} 已安装</strong>
        <span>{result?.status === 'config_required' ? '仍有必填配置未填写，启用前需要先在能力详情里补全。' : '能力已进入能力库，当前为停用状态。'}</span>
      </div></div>
      <div className="ability-empty-actions">
        <button className="quick-secondary" onClick={() => void enable()} disabled={enabling || result?.status === 'config_required'}>
          {enabling && <LoaderCircle size={13} className="spin" />}{enabling ? '启用中…' : '立即启用'}
        </button>
        {result?.abilityType === 'mcp' && <button className="quick-secondary" onClick={() => void test()} disabled={testing}>
          {testing && <LoaderCircle size={13} className="spin" />}{testing ? '测试中…' : '测试连接'}
        </button>}
      </div>
      {actions.errorOf('enable') && <AbilityErrorBlock title="启用失败" message={actions.errorOf('enable') as string} />}
      {actions.errorOf('test') && <AbilityErrorBlock title="连接测试失败" message={actions.errorOf('test') as string} />}
      {testStatus && (testStatus.ok
        ? <div className="ability-test-ok">连接成功 · 发现 {testStatus.toolCount} 个工具</div>
        : <AbilityErrorBlock title="连接失败" message={testStatus.error ?? '未知错误'} actions={<button className="small-control" onClick={() => result && onOpenAbility(result)}>去能力详情编辑配置</button>} />)}
    </div>}
  </CapabilityDrawer>
}
