import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Boxes, CircleCheck, LoaderCircle, Plus, Plug, RefreshCw, Wrench } from 'lucide-react'
import type { Ability, McpAbility, SkillAbility } from '../../../../shared/types'
import { pageOffset, resolvePage } from '../../../../shared/pagination'
import { Pagination } from '../../../components/Pagination'
import { abilityStats } from '../ability-view'
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
import { useEventCallback } from '../../../use-event-callback'
import { abilitiesService } from '../services/abilities-service'
import { hubService } from '../../hub/services/hub-service'
import { mcpService } from '../../mcp/services/mcp-service'
import type { SkillImportFormat } from '../../skills/services/skills-service'

// 「发现」会发起多源网络请求，组件树也不小，不跟能力列表一起进首屏 chunk。
const DiscoverTab = React.lazy(() => import('../../hub/pages/DiscoverTab').then(({ DiscoverTab }) => ({ default: DiscoverTab })))

type AbilityTab = 'discover' | 'skills' | 'mcp'

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
  ['discover', '发现能力'],
  ['skills', 'Skills'],
  ['mcp', 'MCP']
]

/** 「能力」一级页面：安装与管理合并在这里，「发现」Tab 即原来的 Hub 页。 */
export function AbilitiesPage({ onNotice }: {
  onNotice: (notice: string) => void
}) {
  const [tab, setTab] = useState<AbilityTab>('discover')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const { abilities, error, loading, refresh } = useAbilities()
  const { page: requestedPage, pageSize, setPage, setPageSize } = usePagination()
  const actions = useAsyncActions()

  const skills = useMemo(() => (abilities ?? []).filter(isSkill), [abilities])
  const servers = useMemo(() => (abilities ?? []).filter(isMcp), [abilities])

  // 每个 Tab 只对同类能力分页，Tab 上的计数仍取全量；「发现」自带分页，不参与这里
  const rows: Ability[] = tab === 'skills' ? skills : tab === 'mcp' ? servers : []
  const total = rows.length
  const page = resolvePage(requestedPage, total, pageSize)
  const visible = useMemo(() => rows.slice(pageOffset(page, pageSize), pageOffset(page, pageSize) + pageSize), [rows, page, pageSize])
  const visibleSkills = useMemo(() => visible.filter(isSkill), [visible])
  const visibleServers = useMemo(() => visible.filter(isMcp), [visible])

  // 首次加载完成后，有已安装能力优先进入管理页；之后用户切回发现页不再被重置。
  const initialTabResolved = React.useRef(false)
  useEffect(() => {
    if (initialTabResolved.current || !abilities) return
    initialTabResolved.current = true
    if (abilities.length > 0) setTab('skills')
  }, [abilities])

  // 「发现」Tab 装完能力后要跳回对应列表并打开详情，与外部深链走同一条路径。
  const focusAbility = useEventCallback((ability: Ability) => {
    setTab(ability.type === 'skill' ? 'skills' : 'mcp')
    setOverlay(isSkill(ability) ? { kind: 'skill-detail', ability } : { kind: 'mcp-detail', ability: ability as McpAbility })
  })

  // 「发现」Tab 刚装完的能力还不在 abilities 里，先记下 id，等刷新回来再定位。
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const openAbilityById = useEventCallback((abilityId: string) => { setPendingFocusId(abilityId); void refresh() })

  useEffect(() => {
    if (!pendingFocusId || !abilities) return
    const target = abilities.find((ability) => ability.id === pendingFocusId)
    if (!target) return
    focusAbility(target)
    setPendingFocusId(null)
  }, [pendingFocusId, abilities, focusAbility])

  async function importMcp() {
    const created = await actions.run('mcp-import', () => mcpService.import())
    if (created) onNotice(`已导入 ${created.length} 个 MCP Server`)
    await refresh()
  }

  /** 对一遍已装 Hub 能力的远端版本；结果落库后能力状态与侧栏徽标才会显示「有更新」。 */
  async function checkUpdates() {
    const result = await actions.run('check-updates', () => hubService.checkUpdates())
    if (!result) return
    const failed = result.failures.length ? `，${result.failures.length} 个源未响应` : ''
    onNotice(result.checked === 0
      ? '没有来自 Hub 的已安装能力，无需检查'
      : result.updated > 0 ? `${result.updated} 个能力有新版本${failed}` : `已是最新${failed}`)
    await refresh()
  }

  async function openLocation(ability: SkillAbility | McpAbility) {
    const result = await abilitiesService.openLocation(ability.type, ability.id).catch((cause) => (cause instanceof Error ? cause.message : '打开目录失败'))
    if (result) onNotice(result)
  }

  return <div className="capabilities-page">
    <div className="capabilities-header">
      <div>
        <h1>能力</h1>
        <p>为对话与任务添加技能和工具。</p>
      </div>
      <div className="capabilities-actions">
        <button className="quick-secondary" onClick={() => void checkUpdates()} disabled={actions.isPending('check-updates')}>
          {actions.isPending('check-updates') ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}检查更新
        </button>
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
      {tab !== 'discover' && abilities && <AbilitySummary abilities={abilities} />}
      {actions.errorOf('mcp-import') && <AbilityErrorBlock title="导入失败" message={actions.errorOf('mcp-import') as string} />}
      {error ? <AbilityErrorBlock
        title="能力列表加载失败"
        message={error}
        actions={<button className="small-control" onClick={() => void refresh()}>重试</button>}
      /> : loading && !abilities ? <AbilityLoadingState /> : <>
        {tab === 'skills' && <SkillList
          skills={visibleSkills}
          onRefresh={refresh}
          onNotice={onNotice}
          onCreate={() => setOverlay({ kind: 'skill-form', form: { mode: 'create' } })}
          onImport={() => setOverlay({ kind: 'skill-import', format: 'directory' })}
          onEdit={(name) => setOverlay({ kind: 'skill-form', form: { mode: 'edit', name } })}
          onInspect={(ability) => setOverlay({ kind: 'skill-detail', ability })}
          onOpenPlugins={() => setTab('discover')}
        />}
        {tab === 'mcp' && <McpServerList
          servers={visibleServers}
          onRefresh={refresh}
          onNotice={onNotice}
          onCreate={() => setOverlay({ kind: 'mcp-form' })}
          onImport={() => void importMcp()}
          onEdit={(ability) => setOverlay({ kind: 'mcp-form', ability })}
          onInspect={(ability) => setOverlay({ kind: 'mcp-detail', ability })}
          onOpenPlugins={() => setTab('discover')}
        />}
        {tab === 'discover' && <React.Suspense fallback={<AbilityLoadingState />}>
          <DiscoverTab onNotice={onNotice} onOpenAbility={openAbilityById} />
        </React.Suspense>}
        {tab !== 'discover' && <Pagination page={page} pageSize={pageSize} total={total} disabled={loading} onPageChange={setPage} onPageSizeChange={setPageSize} />}
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

function AbilitySummary({ abilities }: { abilities: Ability[] }) {
  const stats = abilityStats(abilities)
  const cards = [
    { label: '已安装', value: stats.total, icon: <Boxes size={15} /> },
    { label: '已启用', value: stats.enabled, icon: <CircleCheck size={15} />, tone: 'success' },
    { label: '待处理', value: stats.attention, icon: <AlertTriangle size={15} />, tone: stats.attention ? 'warning' : 'muted' },
    { label: '可更新', value: stats.updates, icon: <RefreshCw size={15} />, tone: stats.updates ? 'warning' : 'muted' },
    { label: 'Skills', value: stats.skills, icon: <Wrench size={15} /> },
    { label: 'MCP', value: stats.mcp, icon: <Plug size={15} /> }
  ]
  return <div className="cap-summary" aria-label="能力统计">
    {cards.map((card) => <div className={`cap-summary-card ${card.tone ?? ''}`} key={card.label}>
      <span className="cap-summary-icon">{card.icon}</span><span><strong>{card.value}</strong><small>{card.label}</small></span>
    </div>)}
  </div>
}
