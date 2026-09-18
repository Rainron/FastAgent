import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Settings2, TriangleAlert } from 'lucide-react'
import type { AbilityType, HubInstallState, HubListing, HubListingDetail, HubQuery, HubSource, HubSourceFailure } from '../../../../shared/types'
import { AbilityEmptyState, AbilityLoadingState } from '../../abilities/components/AbilityEmptyState'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { PluginCard } from '../../plugins/components/PluginCard'
import { primaryAction, pluginStatus, SORT_OPTIONS } from '../../plugins/plugin-view'
import { HubDetailDrawer } from '../components/HubDetailDrawer'
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

const INSTALL_FILTERS: Array<[HubInstallState, string]> = [
  ['all', '全部'],
  ['not_installed', '未安装'],
  ['installed', '已安装'],
  ['update_available', '有更新']
]

/** 搜索输入的停顿时长。每次触发都是全源并发抓取，单源超时 15s，不能跟着每个字符走。 */
const SEARCH_DEBOUNCE_MS = 300

/** 能力页的「发现」Tab：多源发现与安装，装完的能力回到同页的 Skills / MCP 列表管理。 */
export function DiscoverTab({ onNotice, onOpenAbility }: {
  onNotice: (notice: string) => void
  onOpenAbility?: (abilityId: string) => void
}) {
  const [keyword, setKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [installState, setInstallState] = useState<HubInstallState>('all')
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
  const [installing, setInstalling] = useState<{ listing: HubListing; detail: HubListingDetail | null; mode: 'install' | 'update' } | null>(null)
  const [detail, setDetail] = useState<{ listing: HubListing; detail: HubListingDetail | null; loading: boolean; error: string | null } | null>(null)
  const [managingSources, setManagingSources] = useState(false)
  const requestIdRef = useRef(0)

  const loadSources = useCallback(async () => {
    try {
      setSources(await hubService.sources())
    } catch {
      setSources([])
    }
  }, [])

  // 输入停下来才发请求；分页重置仍绑在 onChange 上，翻页不会等这 300ms。
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [keyword])

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const result = await hubService.search({
        keyword: debouncedKeyword.trim() || undefined,
        abilityType: abilityType === 'all' ? undefined : abilityType,
        category: category === 'all' ? undefined : category,
        installState: installState === 'all' ? undefined : installState,
        sourceIds: sourceId === 'all' ? undefined : [sourceId],
        sort, page, pageSize
      })
      if (requestId !== requestIdRef.current) return
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
  }, [debouncedKeyword, abilityType, category, installState, sourceId, sort, page, pageSize, setPage])

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
    const fetched = await hubService.detail(listing.sourceId, listing.ref).catch(() => null)
    setInstalling({ listing, detail: fetched, mode: action.kind === 'update' ? 'update' : 'install' })
  }

  /** 「详情」与「安装」不再是同一个动作：详情先开抽屉，README 与子能力都在里面。 */
  async function openDetail(listing: HubListing) {
    setDetail({ listing, detail: null, loading: true, error: null })
    try {
      const fetched = await hubService.detail(listing.sourceId, listing.ref)
      setDetail((current) => current?.listing.id === listing.id ? { ...current, detail: fetched, loading: false } : current)
    } catch (cause) {
      // 详情取不到也要能看基本信息与权限，不让整个抽屉打不开。
      setDetail((current) => current?.listing.id === listing.id
        ? { ...current, loading: false, error: cause instanceof Error ? cause.message : '详情加载失败' }
        : current)
    }
  }

  return <div className="cap-tab-content">
    <div className="cap-toolbar">
      <div className="cap-search"><Search size={14} /><input value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1) }} placeholder="搜索能力、作者或分类…" aria-label="搜索能力" /></div>
      <div className="settings-shell-segmented" role="group" aria-label="能力类型">
        {TYPE_FILTERS.map(([key, label]) => <button key={key} className={abilityType === key ? 'active' : ''} onClick={() => { setAbilityType(key); setPage(1) }}>{label}</button>)}
      </div>
      <div className="settings-shell-segmented" role="group" aria-label="安装状态">
        {INSTALL_FILTERS.map(([key, label]) => <button key={key} className={installState === key ? 'active' : ''} onClick={() => { setInstallState(key); setPage(1) }}>{label}</button>)}
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
      <button className="quick-secondary" onClick={() => setManagingSources(true)}><Settings2 size={14} />管理来源（{sources.filter((source) => source.enabled).length}）</button>
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
              onOpen={() => void openDetail(listing)}
              onPrimary={() => void startPrimary(listing)}
            />)}
          </div>}
      {!error && listings && <Pagination page={page} pageSize={pageSize} total={total} disabled={loading} onPageChange={setPage} onPageSizeChange={setPageSize} />}
    </div>

    {detail && <HubDetailDrawer
      listing={detail.listing}
      detail={detail.detail}
      sourceName={sourceNameOf(detail.listing.sourceId)}
      loading={detail.loading}
      error={detail.error}
      onClose={() => setDetail(null)}
      // 抽屉不叠抽屉：关掉自己，安装弹层由这一层渲染。
      onPrimary={() => { const target = detail.listing; setDetail(null); void startPrimary(target) }}
      onOpenAbility={(abilityId) => { setDetail(null); onOpenAbility?.(abilityId) }}
      onUninstalled={() => void refresh()}
      onNotice={onNotice}
    />}
    {installing && <HubInstallDialog
      listing={installing.detail ?? installing.listing}
      contents={installing.detail?.contents ?? []}
      sourceName={sourceNameOf(installing.listing.sourceId)}
      mode={installing.mode}
      onClose={() => setInstalling(null)}
      onInstalled={() => { onNotice(installing.mode === 'update' ? `已更新到 v${installing.listing.version}` : '安装完成，能力已进入能力库（默认停用）'); void refresh() }}
      onOpenAbility={(abilityId) => { setInstalling(null); onOpenAbility?.(abilityId) }}
    />}
    {managingSources && <SourceManagerDialog
      sources={sources}
      onClose={() => setManagingSources(false)}
      onChanged={() => { void loadSources(); void refresh() }}
    />}
  </div>
}
