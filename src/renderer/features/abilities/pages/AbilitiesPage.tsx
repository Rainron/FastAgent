import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Boxes, CircleCheck, LoaderCircle, Plus, Plug, RefreshCw, Search, Wrench } from 'lucide-react'
import type { Ability, McpAbility, SkillAbility } from '../../../../shared/types'
import { pageOffset, resolvePage } from '../../../../shared/pagination'
import { Pagination } from '../../../components/Pagination'
import { isMcp, isSkill, type AbilitySort } from '../ability-view'
import {
  MINE_SORT_OPTIONS,
  MINE_STATUS_OPTIONS,
  displayableAbilities,
  filterMineRows,
  mineAttentionAbilities,
  mineRowsForType,
  mineStats,
  readStoredAbilitiesTab,
  resolveInitialAbilitiesTab,
  sortMineRows,
  writeStoredAbilitiesTab,
  type AbilitiesPageTab,
  type MineStatusFilter,
  type MineTypeFilter
} from '../mine-view'
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
import { AbilityEmptyState, AbilityLoadingState } from '../components/AbilityEmptyState'
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

type Overlay =
  | { kind: 'skill-form'; form: SkillFormMode }
  | { kind: 'skill-import'; format: SkillImportFormat }
  | { kind: 'skill-detail'; ability: SkillAbility }
  | { kind: 'mcp-form'; ability?: McpAbility }
  | { kind: 'mcp-detail'; ability: McpAbility }
  | { kind: 'bundle-export' }
  | { kind: 'bundle-import' }
  | null

const TABS: Array<[AbilitiesPageTab, string]> = [
  ['discover', '发现能力'],
  ['mine', '我的能力']
]

const TYPE_CHIPS: Array<[MineTypeFilter, string]> = [
  ['all', '全部'],
  ['skill', 'Skills'],
  ['mcp', 'MCP'],
  ['attention', '待处理']
]

/** 「能力」一级页面：发现与我的能力两个 Tab，统计与筛选只针对 Skill 与 MCP。 */
export function AbilitiesPage({ onNotice, focusRequest = null, onInsertComposer }: {
  onNotice: (notice: string) => void
  onInsertComposer?: (text: string) => void
  /** 外部深链：定位并展开某个能力的详情；nonce 变化才触发，重复点同一个也生效。 */
  focusRequest?: { abilityId: string; nonce: number } | null
}) {
  const [tab, setTab] = useState<AbilitiesPageTab>(() => resolveInitialAbilitiesTab(readStoredAbilitiesTab(), null) ?? 'discover')
  const [typeFilter, setTypeFilter] = useState<MineTypeFilter>('all')
  const [mineKeyword, setMineKeyword] = useState('')
  const [mineStatus, setMineStatus] = useState<MineStatusFilter>('all')
  const [mineSort, setMineSort] = useState<AbilitySort>('name')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const { abilities, error, loading, refresh } = useAbilities()
  const { page: requestedPage, pageSize, setPage, setPageSize } = usePagination()
  const actions = useAsyncActions()

  const displayable = useMemo(() => displayableAbilities(abilities ?? []), [abilities])
  const skills = useMemo(() => displayable.filter(isSkill), [displayable])
  const servers = useMemo(() => displayable.filter(isMcp), [displayable])
  const attention = useMemo(() => mineAttentionAbilities(displayable), [displayable])

  // 分页只作用于当前类型筛选出的行；统计行永远取全量，不随分页变化
  const rows = useMemo(() => mineRowsForType(displayable, typeFilter), [displayable, typeFilter])
  const filtered = useMemo(
    () => sortMineRows(filterMineRows(rows, { keyword: mineKeyword, status: mineStatus }), mineSort),
    [rows, mineKeyword, mineStatus, mineSort]
  )
  const total = filtered.length
  const page = resolvePage(requestedPage, total, pageSize)
  const visible = useMemo(() => filtered.slice(pageOffset(page, pageSize), pageOffset(page, pageSize) + pageSize), [filtered, page, pageSize])
  const visibleSkills = useMemo(() => visible.filter(isSkill), [visible])
  const visibleServers = useMemo(() => visible.filter(isMcp), [visible])
  const filteredSkillCount = useMemo(() => filtered.filter(isSkill).length, [filtered])
  const filteredServerCount = useMemo(() => filtered.filter(isMcp).length, [filtered])
  // 分区是否渲染取决于该类型在 chips 口径下有没有行，与关键词筛选结果无关
  const showSkillsSection = typeFilter === 'all' || typeFilter === 'attention' ? skills.length > 0 || (typeFilter === 'attention' && attention.some(isSkill)) : typeFilter === 'skill'
  const showServersSection = typeFilter === 'all' || typeFilter === 'attention' ? servers.length > 0 || (typeFilter === 'attention' && attention.some(isMcp)) : typeFilter === 'mcp'

  // 首次进入：没记住 Tab 时，有已安装能力默认开「我的能力」；用户此后切 Tab 只写记忆、不再被覆盖
  const initialTabResolved = useRef(false)
  useEffect(() => {
    if (initialTabResolved.current || !abilities) return
    initialTabResolved.current = true
    const next = resolveInitialAbilitiesTab(readStoredAbilitiesTab(), displayable)
    if (next && next !== tab) setTab(next)
  }, [abilities, displayable, tab])

  function switchTab(next: AbilitiesPageTab) {
    setTab(next)
    writeStoredAbilitiesTab(next)
    setPage(1)
  }

  function switchTypeFilter(next: MineTypeFilter) {
    setTypeFilter(next)
    setPage(1)
  }

  // 「发现」装完能力后要跳回「我的能力」并打开详情，与外部深链走同一条路径；
  // 顺带清掉可能把目标筛掉的查询，保证定位得到。
  const focusAbility = useEventCallback((ability: Ability) => {
    setTab('mine')
    writeStoredAbilitiesTab('mine')
    setTypeFilter(ability.type === 'skill' ? 'skill' : 'mcp')
    setMineKeyword('')
    setMineStatus('all')
    setPage(1)
    setOverlay(isSkill(ability) ? { kind: 'skill-detail', ability } : { kind: 'mcp-detail', ability: ability as McpAbility })
  })

  // 「发现」刚装完的能力还不在 abilities 里，先记下 id，等刷新回来再定位。
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const openAbilityById = useEventCallback((abilityId: string) => { setPendingFocusId(abilityId); void refresh() })

  useEffect(() => {
    if (!pendingFocusId || !abilities) return
    const target = abilities.find((ability) => ability.id === pendingFocusId)
    if (!target) return
    focusAbility(target)
    setPendingFocusId(null)
  }, [pendingFocusId, abilities, focusAbility])

  // 深链只认 nonce：页面本身常驻在分区里，靠 abilityId 变化会漏掉「连点同一个」。
  const handledFocusNonce = useRef(0)
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === handledFocusNonce.current) return
    handledFocusNonce.current = focusRequest.nonce
    openAbilityById(focusRequest.abilityId)
  }, [focusRequest, openAbilityById])

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

    <nav className="capabilities-tabs" role="tablist" aria-label="能力分区">
      {TABS.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => switchTab(key)}>{label}</button>
      ))}
    </nav>

    <div className="capabilities-content">
      {actions.errorOf('mcp-import') && <AbilityErrorBlock title="导入失败" message={actions.errorOf('mcp-import') as string} />}
      {error ? <AbilityErrorBlock
        title="能力列表加载失败"
        message={error}
        actions={<button className="small-control" onClick={() => void refresh()}>重试</button>}
      /> : loading && !abilities ? <AbilityLoadingState /> : <>
        {tab === 'mine' && abilities && <>
          <AbilitySummary abilities={abilities} />
          {displayable.length === 0 ? <AbilityEmptyState
            title="还没有已安装的能力"
            description="从「发现能力」安装，或使用右上角「添加能力」手动创建、导入。"
            action={<button className="primary-button" onClick={() => switchTab('discover')}>去发现能力</button>}
          /> : <>
            <div className="cap-toolbar cap-mine-toolbar">
              <div className="cap-chips" role="group" aria-label="能力类型">
                {TYPE_CHIPS.map(([key, label]) => {
                  const count = key === 'all' ? displayable.length : key === 'skill' ? skills.length : key === 'mcp' ? servers.length : attention.length
                  return <button key={key} className={typeFilter === key ? 'active' : ''} onClick={() => switchTypeFilter(key)}>
                    {label}{count ? ` (${count})` : ''}
                  </button>
                })}
              </div>
              <div className="cap-search">
                <Search size={14} />
                <input
                  value={mineKeyword}
                  onChange={(event) => { setMineKeyword(event.target.value); setPage(1) }}
                  placeholder="搜索我的能力…"
                  aria-label="搜索我的能力"
                />
              </div>
              <label className="ability-select"><span>状态</span>
                <select value={mineStatus} onChange={(event) => { setMineStatus(event.target.value as MineStatusFilter); setPage(1) }}>
                  {MINE_STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label className="ability-select"><span>排序</span>
                <select value={mineSort} onChange={(event) => setMineSort(event.target.value as AbilitySort)}>
                  {MINE_SORT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
            </div>
            {showSkillsSection && <section className="cap-mine-section">
              {typeFilter !== 'skill' && <div className="cap-section-heading"><span>Skills</span><small>{filteredSkillCount}</small></div>}
              <SkillList
                embedded
                skills={visibleSkills}
                onRefresh={refresh}
                onNotice={onNotice}
                onCreate={() => setOverlay({ kind: 'skill-form', form: { mode: 'create' } })}
                onImport={() => setOverlay({ kind: 'skill-import', format: 'directory' })}
                onEdit={(name) => setOverlay({ kind: 'skill-form', form: { mode: 'edit', name } })}
                onInspect={(ability) => setOverlay({ kind: 'skill-detail', ability })}
              />
            </section>}
            {showServersSection && <section className="cap-mine-section">
              {typeFilter !== 'mcp' && <div className="cap-section-heading"><span>MCP Servers</span><small>{filteredServerCount}</small></div>}
              <McpServerList
                embedded
                servers={visibleServers}
                onRefresh={refresh}
                onNotice={onNotice}
                onCreate={() => setOverlay({ kind: 'mcp-form' })}
                onImport={() => void importMcp()}
                onEdit={(ability) => setOverlay({ kind: 'mcp-form', ability })}
                onInspect={(ability) => setOverlay({ kind: 'mcp-detail', ability })}
              />
            </section>}
            <Pagination page={page} pageSize={pageSize} total={total} disabled={loading} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>}
        </>}
        {tab === 'discover' && <React.Suspense fallback={<AbilityLoadingState />}>
          <DiscoverTab onNotice={onNotice} onOpenAbility={openAbilityById} />
        </React.Suspense>}
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
      onNotice={onNotice}
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
      onInsertComposer={onInsertComposer}
    />}
  </div>
}

function AbilitySummary({ abilities }: { abilities: Ability[] }) {
  const stats = mineStats(abilities)
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
