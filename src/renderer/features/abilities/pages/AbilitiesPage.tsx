import { useEffect, useMemo, useState } from 'react'
import { Plus, Store } from 'lucide-react'
import type { Ability, McpAbility, SkillAbility } from '../../../../shared/types'
import { pageOffset, resolvePage } from '../../../../shared/pagination'
import { Pagination } from '../../../components/Pagination'
import { OverviewTab } from './OverviewTab'
import { SkillList } from '../../skills/components/SkillList'
import { SkillCreateForm, type SkillFormMode } from '../../skills/components/SkillCreateForm'
import { SkillDetailPanel } from '../../skills/components/SkillDetailPanel'
import { SkillImportDialog } from '../../skills/components/SkillImportDialog'
import { McpServerList } from '../../mcp/components/McpServerList'
import { McpServerForm } from '../../mcp/components/McpServerForm'
import { McpServerDetailPanel } from '../../mcp/components/McpServerDetailPanel'
import { AbilityMenu } from '../components/AbilityMenu'
import { BundleExportDialog } from '../components/BundleExportDialog'
import { BundleImportDialog } from '../components/BundleImportDialog'
import { AbilityErrorBlock } from '../components/AbilityErrorBlock'
import { AbilityLoadingState } from '../components/AbilityEmptyState'
import { isMcp, isSkill } from '../ability-view'
import { useAbilities } from '../hooks/useAbilities'
import { useAsyncActions } from '../hooks/useAsyncAction'
import { usePagination } from '../../../use-pagination'
import { abilitiesService } from '../services/abilities-service'
import { mcpService } from '../../mcp/services/mcp-service'
import type { SkillImportFormat } from '../../skills/services/skills-service'

type AbilityTab = 'overview' | 'skills' | 'mcp'

type Overlay =
  | { kind: 'skill-form'; form: SkillFormMode }
  | { kind: 'skill-import'; format: SkillImportFormat }
  | { kind: 'skill-detail'; ability: SkillAbility }
  | { kind: 'mcp-form'; ability?: McpAbility }
  | { kind: 'mcp-detail'; ability: McpAbility }
  | { kind: 'bundle-export' }
  | { kind: 'bundle-import' }
  | null

const TABS: Array<[AbilityTab, string]> = [
  ['overview', '概览'],
  ['skills', 'Skills'],
  ['mcp', 'MCP Servers']
]

/** 「能力」一级页面：Agent 可用的扩展能力在这里管理、配置、启停与测试。 */
export function AbilitiesPage({ onNotice, onOpenPlugins, focusAbilityId, onFocusHandled }: {
  onNotice: (notice: string) => void
  onOpenPlugins?: () => void
  /** 从插件页安装完成后跳转过来时定位到的能力 */
  focusAbilityId?: string | null
  onFocusHandled?: () => void
}) {
  const [tab, setTab] = useState<AbilityTab>('overview')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const { abilities, error, loading, refresh } = useAbilities()
  const { page: requestedPage, pageSize, setPage, setPageSize } = usePagination()
  const actions = useAsyncActions()

  const skills = useMemo(() => (abilities ?? []).filter(isSkill), [abilities])
  const servers = useMemo(() => (abilities ?? []).filter(isMcp), [abilities])

  // 每个 Tab 只对同类能力分页，Tab 上的计数仍取全量
  const rows: Ability[] = tab === 'skills' ? skills : tab === 'mcp' ? servers : (abilities ?? [])
  const total = rows.length
  const page = resolvePage(requestedPage, total, pageSize)
  const visible = useMemo(() => rows.slice(pageOffset(page, pageSize), pageOffset(page, pageSize) + pageSize), [rows, page, pageSize])
  const visibleSkills = useMemo(() => visible.filter(isSkill), [visible])
  const visibleServers = useMemo(() => visible.filter(isMcp), [visible])

  useEffect(() => {
    if (!focusAbilityId || !abilities) return
    const target = abilities.find((ability) => ability.id === focusAbilityId)
    if (!target) return
    setTab(target.type === 'skill' ? 'skills' : 'mcp')
    setOverlay(isSkill(target) ? { kind: 'skill-detail', ability: target } : { kind: 'mcp-detail', ability: target as McpAbility })
    onFocusHandled?.()
  }, [focusAbilityId, abilities, onFocusHandled])

  async function importMcp() {
    const created = await actions.run('mcp-import', () => mcpService.import())
    if (created) onNotice(`已导入 ${created.length} 个 MCP Server`)
    await refresh()
  }

  async function openLocation(ability: SkillAbility | McpAbility) {
    const result = await abilitiesService.openLocation(ability.type, ability.id).catch((cause) => (cause instanceof Error ? cause.message : '打开目录失败'))
    if (result) onNotice(result)
  }

  return <div className="capabilities-page">
    <div className="capabilities-header">
      <div>
        <span className="eyebrow">ABILITIES</span>
        <h1>Agent 能力</h1>
        <p>Skill 提供任务知识和工作流，MCP Server 提供外部工具与数据源；安装与启用分离，只有显式启用的能力 Agent 才可见。</p>
      </div>
      <div className="capabilities-actions">
        {onOpenPlugins && <button className="quick-secondary" onClick={onOpenPlugins}><Store size={14} />从插件市场添加</button>}
        <AbilityMenu
          label="添加能力"
          trigger={<><Plus size={15} />添加能力</>}
          items={[
            { key: 'create-skill', label: '创建 Skill', onSelect: () => setOverlay({ kind: 'skill-form', form: { mode: 'create' } }) },
            { key: 'import-skill-zip', label: '导入 Skill 压缩包', onSelect: () => setOverlay({ kind: 'skill-import', format: 'zip' }) },
            { key: 'import-skill-dir', label: '从本地目录导入', onSelect: () => setOverlay({ kind: 'skill-import', format: 'directory' }) },
            { key: 'add-mcp', label: '添加 MCP Server', onSelect: () => setOverlay({ kind: 'mcp-form' }) },
            { key: 'import-mcp', label: '导入 MCP 配置', disabled: actions.isPending('mcp-import'), onSelect: () => void importMcp() },
            { key: 'import-bundle', label: '导入能力整包', onSelect: () => setOverlay({ kind: 'bundle-import' }) },
            { key: 'export-bundle', label: '导出能力整包', disabled: !abilities?.length, onSelect: () => setOverlay({ kind: 'bundle-export' }) }
          ]}
        />
      </div>
    </div>

    <nav className="capabilities-tabs" role="tablist" aria-label="能力类型">
      {TABS.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setPage(1) }}>
          {label}{key === 'skills' && skills.length ? ` (${skills.length})` : key === 'mcp' && servers.length ? ` (${servers.length})` : ''}
        </button>
      ))}
    </nav>

    <div className="capabilities-content">
      {actions.errorOf('mcp-import') && <AbilityErrorBlock title="导入失败" message={actions.errorOf('mcp-import') as string} />}
      {error ? <AbilityErrorBlock
        title="能力列表加载失败"
        message={error}
        actions={<button className="small-control" onClick={() => void refresh()}>重试</button>}
      /> : loading && !abilities ? <AbilityLoadingState /> : <>
        {tab === 'overview' && <OverviewTab
          abilities={visible}
          onOpen={(ability) => setOverlay(isSkill(ability) ? { kind: 'skill-detail', ability } : { kind: 'mcp-detail', ability: ability as McpAbility })}
        />}
        {tab === 'skills' && <SkillList
          skills={visibleSkills}
          onRefresh={refresh}
          onNotice={onNotice}
          onCreate={() => setOverlay({ kind: 'skill-form', form: { mode: 'create' } })}
          onImport={() => setOverlay({ kind: 'skill-import', format: 'directory' })}
          onEdit={(name) => setOverlay({ kind: 'skill-form', form: { mode: 'edit', name } })}
          onInspect={(ability) => setOverlay({ kind: 'skill-detail', ability })}
          onOpenPlugins={onOpenPlugins}
        />}
        {tab === 'mcp' && <McpServerList
          servers={visibleServers}
          onRefresh={refresh}
          onNotice={onNotice}
          onCreate={() => setOverlay({ kind: 'mcp-form' })}
          onImport={() => void importMcp()}
          onEdit={(ability) => setOverlay({ kind: 'mcp-form', ability })}
          onInspect={(ability) => setOverlay({ kind: 'mcp-detail', ability })}
          onOpenPlugins={onOpenPlugins}
        />}
        <Pagination page={page} pageSize={pageSize} total={total} disabled={loading} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </>}
    </div>

    {overlay?.kind === 'skill-form' && <SkillCreateForm
      form={overlay.form}
      onClose={() => setOverlay(null)}
      onSaved={(name) => { setOverlay(null); onNotice(`已保存 Skill：${name}`); void refresh() }}
    />}
    {overlay?.kind === 'skill-import' && <SkillImportDialog
      defaultFormat={overlay.format}
      onClose={() => setOverlay(null)}
      onImported={(name) => { setOverlay(null); onNotice(`已导入 Skill：${name}（默认停用）`); void refresh() }}
    />}
    {overlay?.kind === 'skill-detail' && <SkillDetailPanel
      ability={overlay.ability}
      onClose={() => setOverlay(null)}
      onOpenLocation={() => void openLocation(overlay.ability)}
    />}
    {overlay?.kind === 'mcp-form' && <McpServerForm
      ability={overlay.ability}
      onClose={() => setOverlay(null)}
      onSaved={(name) => { setOverlay(null); onNotice(`已保存 MCP Server：${name}`); void refresh() }}
    />}
    {overlay?.kind === 'bundle-export' && <BundleExportDialog
      abilities={abilities ?? []}
      onClose={() => setOverlay(null)}
      onNotice={onNotice}
    />}
    {overlay?.kind === 'bundle-import' && <BundleImportDialog
      onClose={() => setOverlay(null)}
      onNotice={onNotice}
      onImported={() => void refresh()}
    />}
    {overlay?.kind === 'mcp-detail' && <McpServerDetailPanel
      ability={overlay.ability}
      onClose={() => setOverlay(null)}
      onEdit={() => setOverlay({ kind: 'mcp-form', ability: overlay.ability })}
      onReconnect={() => { void mcpService.test(overlay.ability.id).then(() => refresh()).catch(() => onNotice('连接测试失败')) }}
    />}
  </div>
}
