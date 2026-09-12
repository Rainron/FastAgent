import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Settings2, TriangleAlert } from 'lucide-react'
import type { AbilityType, HubListing, HubListingDetail, HubQuery, HubSource, HubSourceFailure } from '../../../../shared/types'
import { AbilityEmptyState, AbilityLoadingState } from '../../abilities/components/AbilityEmptyState'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { PluginCard } from '../../plugins/components/PluginCard'
import { primaryAction, pluginStatus, SORT_OPTIONS } from '../../plugins/plugin-view'
import { HubInstallDialog } from '../components/HubInstallDialog'
import { SourceManagerDialog } from '../components/SourceManagerDialog'
import { failureSummary } from '../hub-view'
import { hubService } from '../services/hub-service'
import { Pagination } from '../../../components/Pagination'
import { usePagination } from '../../../use-pagination'

const TYPE_FILTERS: Array<[AbilityType | 'all', string]> = [
  ['all', '全部'],
  ['skill', 'Skills'],
  ['mcp', 'MCP Servers'],
  ['cli', 'CLI 工具']
]

/** Hub：多源发现与安装入口。安装后的能力进入「能力」页管理。 */
export function HubPage({ onNotice, onOpenAbility }: {
  onNotice: (notice: string) => void
  onOpenAbility?: (abilityId: string) => void
}) {
  const [keyword, setKeyword] = useState('')
  const [abilityType, setAbilityType] = useState<AbilityType | 'all'>('all')
  const [category, setCategory] = useState('all')
  const [sourceId, setSourceId] = useState('all')
  const [sort, setSort] = useState<NonNullable<HubQuery['sort']>>('featured')
  const [listings, setListings] = useState<HubListing[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const { page, pageSize, setPage, setPageSize } = usePagination()
  const [failures, setFailures] = useState<HubSourceFailure[]>([])
  const [sources, setSources] = useState<HubSource[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState<{ listing: HubListing; detail: HubListingDetail | null } | null>(null)
  const [managingSources, setManagingSources] = useState(false)

  const loadSources = useCallback(async () => {
    try {
      setSources(await hubService.sources())
    } catch {
      setSources([])
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await hubService.search({
        keyword: keyword.trim() || undefined,
        abilityType: abilityType === 'all' ? undefined : abilityType,
        category: category === 'all' ? undefined : category,
        sourceIds: sourceId === 'all' ? undefined : [sourceId],
        sort, page, pageSize
      })
      setListings(result.items)
      setTotal(result.total)
      // 源返回的条数会变，服务端夹回页码后本地要同步
      if (result.page !== page) setPage(result.page)
      setFailures(result.failures)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Hub 搜索失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, abilityType, category, sourceId, sort, page, pageSize, setPage])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void loadSources() }, [loadSources])
  useEffect(() => { void hubService.categories().then(setCategories).catch(() => setCategories([])) }, [])

  const failureNotice = useMemo(() => failureSummary(failures, sources), [failures, sources])
  const sourceNameOf = useCallback((id: string) => sources.find((source) => source.id === id)?.name ?? id, [sources])

  async function startPrimary(listing: HubListing) {
    const action = primaryAction(listing, pluginStatus(listing))
    if (action.kind === 'open' && listing.abilityId) {
      onOpenAbility?.(listing.abilityId)
      return
    }
    // 子能力清单与准确的权限告示都只在详情里有；取不到时退回搜索结果那份。
    const detail = await hubService.detail(listing.sourceId, listing.ref).catch(() => null)
    setInstalling({ listing, detail })
  }

  return <div className="plugins-page">
    <div className="capabilities-header">
      <div>
        <span className="eyebrow">HUB</span>
        <h1>能力 Hub</h1>
        <p>从内置目录与你添加的第三方源获取能力。安装后的 Skill 与 MCP Server 会进入「能力」页，默认停用，需要显式启用后 Agent 才可见。</p>
      </div>
      <div className="capabilities-actions">
        <button className="quick-secondary" onClick={() => setManagingSources(true)}><Settings2 size={14} />管理来源（{sources.filter((source) => source.enabled).length}）</button>
      </div>
    </div>

    <div className="cap-toolbar">
      <div className="cap-search"><Search size={14} /><input value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1) }} placeholder="搜索能力、作者或分类…" aria-label="搜索能力" /></div>
      <div className="settings-shell-segmented" role="group" aria-label="能力类型">
        {TYPE_FILTERS.map(([key, label]) => <button key={key} className={abilityType === key ? 'active' : ''} onClick={() => { setAbilityType(key); setPage(1) }}>{label}</button>)}
      </div>
      <div className="settings-shell-segmented" role="group" aria-label="排序">
        {SORT_OPTIONS.map(([key, label]) => <button key={key} className={sort === key ? 'active' : ''} onClick={() => { setSort(key); setPage(1) }}>{label}</button>)}
      </div>
      <label className="ability-select"><span>来源</span>
        <select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setPage(1) }}>
          <option value="all">全部来源</option>
          {sources.filter((source) => source.enabled).map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select>
      </label>
      <label className="ability-select"><span>分类</span>
        <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1) }}>
          <option value="all">全部分类</option>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
    </div>

    <div className="capabilities-content">
      {failureNotice && <div className="hub-failure-banner"><TriangleAlert size={14} />{failureNotice}</div>}
      {error ? <AbilityErrorBlock title="Hub 搜索失败" message={error} actions={<button className="small-control" onClick={() => void refresh()}>重试</button>} />
        : !listings ? <AbilityLoadingState />
        : listings.length === 0 ? <AbilityEmptyState
            title="没有匹配的能力"
            description={sources.filter((source) => source.enabled).length <= 1 ? '只启用了内置目录。添加一个 Git 源可以接入更多社区能力。' : '调整关键词、类型或来源后再试。'}
            action={<button className="quick-secondary" onClick={() => setManagingSources(true)}>管理来源</button>}
          />
        : <div className="plugin-list">
            {listings.map((listing) => <PluginCard
              key={listing.id}
              plugin={listing}
              onOpen={() => void startPrimary(listing)}
              onPrimary={() => void startPrimary(listing)}
            />)}
          </div>}
      {!error && listings && <Pagination page={page} pageSize={pageSize} total={total} disabled={loading} onPageChange={setPage} onPageSizeChange={setPageSize} />}
    </div>

    {installing && <HubInstallDialog
      listing={installing.detail ?? installing.listing}
      contents={installing.detail?.contents ?? []}
      sourceName={sourceNameOf(installing.listing.sourceId)}
      onClose={() => setInstalling(null)}
      onInstalled={() => { onNotice('安装完成，能力已进入能力库（默认停用）'); void refresh() }}
      onOpenAbility={(abilityId) => { setInstalling(null); onOpenAbility?.(abilityId) }}
    />}
    {managingSources && <SourceManagerDialog
      sources={sources}
      onClose={() => setManagingSources(false)}
      onChanged={() => { void loadSources(); void refresh() }}
    />}
  </div>
}
