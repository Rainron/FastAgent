import { useMemo, useState } from 'react'
import { Edit3, FolderOpen, Info, LoaderCircle, MoreHorizontal, Plug, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { McpAbility } from '../../../../shared/types'
import { AbilityStatusBadge } from '../../abilities/components/AbilityStatusBadge'
import { AbilityEmptyState } from '../../abilities/components/AbilityEmptyState'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { AbilityMenu } from '../../abilities/components/AbilityMenu'
import { abilityStatusPresentation, canUninstall, connectionPresentation, filterMcpAbilities, SOURCE_LABELS, transportLabel, type McpStatusFilter } from '../../abilities/ability-view'
import { useAsyncActions } from '../../abilities/hooks/useAsyncAction'
import { abilitiesService } from '../../abilities/services/abilities-service'
import { mcpService } from '../services/mcp-service'

const STATUS_FILTERS: Array<[McpStatusFilter, string]> = [
  ['all', '全部'],
  ['connected', '已连接'],
  ['disconnected', '未连接'],
  ['error', '连接异常'],
  ['disabled', '已禁用']
]

export function McpServerList({ servers, onRefresh, onNotice, onInspect, onEdit, onCreate, onImport, onOpenPlugins }: {
  servers: McpAbility[]
  onRefresh: () => Promise<void>
  onNotice: (notice: string) => void
  onInspect: (ability: McpAbility) => void
  onEdit: (ability: McpAbility) => void
  onCreate: () => void
  onImport: () => void
  onOpenPlugins?: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState<McpStatusFilter>('all')
  const actions = useAsyncActions()

  const visible = useMemo(() => filterMcpAbilities(servers, filter, keyword), [servers, filter, keyword])

  async function test(ability: McpAbility) {
    const status = await actions.run(`test:${ability.id}`, () => mcpService.test(ability.id))
    if (status) onNotice(status.ok ? `连接成功 · ${ability.name} · 发现 ${status.toolCount} 个工具` : `连接失败：${status.error ?? '未知错误'}`)
    await onRefresh()
  }

  async function toggle(ability: McpAbility) {
    await actions.run(`toggle:${ability.id}`, () => abilitiesService.setEnabled('mcp', ability.id, !ability.enabled))
    await onRefresh()
  }

  async function remove(ability: McpAbility) {
    await actions.run(`remove:${ability.id}`, async () => {
      await mcpService.remove(ability.id)
      onNotice(`已删除 MCP Server：${ability.name}`)
    })
    await onRefresh()
  }

  async function openLocation(ability: McpAbility) {
    const result = await actions.run(`open:${ability.id}`, () => abilitiesService.openLocation('mcp', ability.id))
    if (result) onNotice(result)
  }

  return <div className="cap-tab-content">
    <div className="cap-toolbar">
      <div className="cap-search"><Search size={14} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 MCP Server…" aria-label="搜索 MCP Server" /></div>
      <div className="settings-shell-segmented" role="group" aria-label="MCP 状态筛选">
        {STATUS_FILTERS.map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>)}
      </div>
      <div className="cap-toolbar-spacer" />
      <button className="quick-secondary" onClick={onImport}>导入配置</button>
      <button className="primary-button" onClick={onCreate}>添加 Server</button>
    </div>

    {visible.length === 0 ? (
      servers.length === 0
        ? <AbilityEmptyState
            title="还没有 MCP Server"
            description="MCP Server 为 Agent 提供外部工具与数据源。可以从插件市场安装，也可以手动添加或导入 JSON 配置。"
            action={<>
              {onOpenPlugins && <button className="primary-button" onClick={onOpenPlugins}>去插件市场</button>}
              <button className="quick-secondary" onClick={onCreate}>手动添加</button>
              <button className="quick-secondary" onClick={onImport}>导入配置</button>
            </>}
          />
        : <AbilityEmptyState title="没有匹配的 MCP Server" description="调整关键词或筛选条件后再试。" action={<button className="quick-secondary" onClick={() => { setKeyword(''); setFilter('all') }}>清除筛选</button>} />
    ) : (
      <div className="ability-list">
        {visible.map((ability) => {
          const testing = actions.isPending(`test:${ability.id}`)
          const busy = testing || actions.isPending(`toggle:${ability.id}`) || actions.isPending(`remove:${ability.id}`)
          const actionError = actions.errorOf(`test:${ability.id}`) ?? actions.errorOf(`toggle:${ability.id}`) ?? actions.errorOf(`remove:${ability.id}`)
          const failed = ability.connection.state === 'error'
          return <div className="ability-row" key={ability.id}>
            <div className="ability-row-main">
              <div className="ability-row-title">
                <span className="cap-row-icon"><span className={`cap-status-dot ${ability.connection.state === 'connected' ? 'online' : failed ? 'offline' : 'idle'}`} /></span>
                <strong>{ability.displayName}</strong>
                <AbilityStatusBadge status={abilityStatusPresentation(ability.status)} />
                <AbilityStatusBadge status={connectionPresentation(ability.connection.state)} title={ability.connection.testedAt ? `最近检测：${new Date(ability.connection.testedAt).toLocaleString()}` : undefined} />
              </div>
              <small className="mono">{transportLabel(ability)}</small>
              <div className="ability-row-meta">
                <span>Tools {ability.connection.toolCount}</span>
                <span>Resources {ability.connection.resourceCount}</span>
                <span>Prompts {ability.connection.promptCount}</span>
                <span>{ability.timeoutMs}ms 超时</span>
                <span>{ability.hasSecrets ? '已保存密钥' : '无密钥'}</span>
                <span>{SOURCE_LABELS[ability.source]}</span>
              </div>
              {(failed || ability.status === 'config_required') && <AbilityErrorBlock
                title={ability.status === 'config_required' ? '缺少必填配置' : '连接失败'}
                message={ability.error?.message ?? ability.connection.error ?? '必填项未填写，Server 无法建立连接。'}
                actions={<>
                  <button className="small-control" onClick={() => onEdit(ability)}><Edit3 size={13} />编辑配置</button>
                  <button className="small-control" onClick={() => void test(ability)} disabled={testing}>{testing ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}重新连接</button>
                </>}
              />}
              {actionError && <AbilityErrorBlock message={actionError} actions={<button className="small-control" onClick={() => void onRefresh()}><RefreshCw size={13} />重试</button>} />}
            </div>
            <div className="ability-row-actions">
              <button className="small-control" onClick={() => void test(ability)} disabled={testing} title={failed ? '上次连接失败，点击重新连接' : `连接测试：${ability.name}`}>
                {testing ? <LoaderCircle size={13} className="spin" /> : <Plug size={13} />}{testing ? '测试中…' : failed ? '重新连接' : '测试连接'}
              </button>
              <label className="switch-row" title="启用后 Agent 运行时才会建立该 Server 的连接">
                <input type="checkbox" checked={ability.enabled} disabled={busy} onChange={() => void toggle(ability)} />
                <span className="switch-visual" />
                <span>{ability.enabled ? 'Agent 可用' : 'Agent 停用'}</span>
              </label>
              <AbilityMenu
                label={`${ability.displayName} 的更多操作`}
                trigger={<MoreHorizontal size={15} />}
                items={[
                  { key: 'detail', label: '查看详情', icon: <Info size={13} />, onSelect: () => onInspect(ability) },
                  { key: 'edit', label: '编辑配置', icon: <Edit3 size={13} />, onSelect: () => onEdit(ability) },
                  { key: 'open', label: '打开目录', icon: <FolderOpen size={13} />, onSelect: () => void openLocation(ability) },
                  ...(canUninstall(ability) ? [{ key: 'remove', label: '删除', icon: <Trash2 size={13} />, danger: true, onSelect: () => void remove(ability) }] : [])
                ]}
              />
            </div>
          </div>
        })}
      </div>
    )}
    <p className="settings-hint">连接在每轮 Agent 运行时按启用状态建立、结束后关闭；Tools 是否放行由「设置 → Agent 与权限」的授权策略决定。密钥使用系统加密保存。</p>
  </div>
}
