import type { Ability, HubInstallResult, HubListing, HubListingDetail, HubQuery, HubSearchResult, HubSource, HubSourceInput } from '../../shared/types'
import type { LocalStore } from '../local-store'
import type { PluginCatalogProvider } from '../plugins/catalog'
import { normalizePageSize, pageOffset, resolvePage } from '../../shared/pagination'
import { decorateListings, searchProviders } from '../registry/aggregator'
import { BUILTIN_SOURCE_ID, BuiltinRegistryProvider } from '../registry/providers/builtin'
import { GitMarketplaceProvider } from '../registry/providers/git'
import { McpRegistryProvider } from '../registry/providers/mcp-registry'
import { SkillsMpProvider } from '../registry/providers/skillsmp'
import { listingId, type RegistryProvider } from '../registry/types'
import type { LocalSkillRegistry } from '../skill-registry'
import { installPayloads } from './payload-installer'

/** store / skillRegistry 在 app.whenReady 里才赋值，用取值函数拿最新引用。 */
export interface HubServiceDeps {
  store(): LocalStore
  skillRegistry(): LocalSkillRegistry
  catalogProvider: PluginCatalogProvider
  listAbilities(): Promise<Ability[]>
}

/** 尚未落地的源类型不静默跳过：搜索时抛错，用户在结果页能看到是哪个源没生效。 */
function unsupportedProvider(source: HubSource): RegistryProvider {
  const fail = () => { throw new Error(`源类型 ${source.kind} 尚未支持`) }
  return { id: source.id, kind: source.kind, name: source.name, search: fail, detail: fail, fetchPayload: fail }
}

export function createHubService({ store, skillRegistry, catalogProvider, listAbilities }: HubServiceDeps) {
  // provider 持有归档缓存，必须跨调用复用，否则搜索一次下载一次。
  const providerCache = new Map<string, { updatedAt: string; provider: RegistryProvider }>()

  function apiKeyOf(id: string) {
    try {
      return store().getHubSourceApiKey(id)
    } catch {
      // 换机器后解不开密钥时按「没配」处理，让源自己报鉴权失败，比整页崩掉好。
      return null
    }
  }

  function providerFor(source: HubSource): RegistryProvider {
    const cached = providerCache.get(source.id)
    // 源配置一改（换了仓库或 ref）就丢弃旧 provider 连同它的缓存。
    if (cached && cached.updatedAt === source.updatedAt) return cached.provider
    const provider = source.kind === 'builtin' ? new BuiltinRegistryProvider(catalogProvider)
      : source.kind === 'git' ? new GitMarketplaceProvider(source)
      : source.kind === 'mcp-registry' ? new McpRegistryProvider(source)
      // 密钥在主进程解出来传给 provider，不经 IPC。该站目前不要求鉴权，配了就带上。
      : source.kind === 'skillsmp' ? new SkillsMpProvider(source, { apiKey: apiKeyOf(source.id) })
      : unsupportedProvider(source)
    providerCache.set(source.id, { updatedAt: source.updatedAt, provider })
    return provider
  }

  /** 内置目录始终是一个源，第一次启动时补一行，用户可以停用但不能删。 */
  function ensureBuiltinSource() {
    if (store().listHubSources().some((source) => source.id === BUILTIN_SOURCE_ID)) return
    store().saveHubSource({ id: BUILTIN_SOURCE_ID, kind: 'builtin', name: '内置目录', enabled: true, sortOrder: 0, builtin: true, status: 'ready' })
  }

  function sources(): HubSource[] {
    ensureBuiltinSource()
    return store().listHubSources()
  }

  function activeProviders(sourceIds?: string[]): RegistryProvider[] {
    return sources()
      .filter((source) => source.enabled && (!sourceIds?.length || sourceIds.includes(source.id)))
      .map(providerFor)
  }

  function requireSource(id: string): HubSource {
    const source = sources().find((item) => item.id === id)
    if (!source) throw new Error(`源不存在：${id}`)
    return source
  }

  async function search(query: HubQuery, signal: AbortSignal): Promise<HubSearchResult> {
    const pageSize = normalizePageSize(query.pageSize)
    // 总条数要覆盖全部结果，所以不让抓取上限截断各源返回
    const { items, failures } = await searchProviders(activeProviders(query.sourceIds), { ...query, limit: undefined }, signal)
    const decorated = decorateListings(items, await listAbilities()) as HubListing[]
    const page = resolvePage(query.page, decorated.length, pageSize)
    const offset = pageOffset(page, pageSize)
    return { items: decorated.slice(offset, offset + pageSize), failures, total: decorated.length, page, pageSize }
  }

  async function detail(sourceId: string, ref: string, signal: AbortSignal): Promise<HubListingDetail> {
    const source = requireSource(sourceId)
    const draft = await providerFor(source).detail(ref, signal)
    const [decorated] = decorateListings([{ ...draft, sourceId, id: listingId(sourceId, ref) }], await listAbilities())
    return { ...decorated, readme: draft.readme, contents: draft.contents }
  }

  async function install(sourceId: string, ref: string, config: Record<string, string>, signal: AbortSignal): Promise<HubInstallResult> {
    const source = requireSource(sourceId)
    const provider = providerFor(source)
    const [payloads, listing] = await Promise.all([provider.fetchPayload(ref, signal), provider.detail(ref, signal)])
    const installed = installPayloads(payloads, {
      sourceId,
      ref,
      version: listing.version,
      configFields: listing.configFields,
      config
    }, { skills: skillRegistry(), store: store() })
    return { installed }
  }

  function saveSource(input: HubSourceInput): HubSource {
    if (input.id === BUILTIN_SOURCE_ID && input.kind !== 'builtin') throw new Error('内置目录的类型不能修改')
    if (input.kind === 'git' && !input.url?.trim()) throw new Error('Git 源必须填仓库地址')
    return store().saveHubSource(input)
  }

  function removeSource(id: string) {
    if (requireSource(id).builtin) throw new Error('内置目录不能删除')
    store().removeHubSource(id)
    providerCache.delete(id)
  }

  /** 拉一条结果验证源可达。结果落回源行，列表页不用每次重试就能显示上次状态。 */
  async function testSource(id: string, signal: AbortSignal): Promise<HubSource> {
    const source = requireSource(id)
    try {
      await providerFor(source).search({ limit: 1 }, signal)
      return store().saveHubSource({ ...source, status: 'ready', statusMessage: null, checkedAt: new Date().toISOString() })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = /401|403|未授权|unauthorized/i.test(message) ? 'unauthorized' : 'unreachable'
      return store().saveHubSource({ ...source, status, statusMessage: message, checkedAt: new Date().toISOString() })
    }
  }

  async function categories(signal: AbortSignal): Promise<string[]> {
    const lists = await Promise.all(activeProviders().map(async (provider) => {
      try {
        return await provider.categories?.(signal) ?? []
      } catch {
        // 分类只是筛选辅助，取不到就当这个源没有分类，不打断页面。
        return []
      }
    }))
    return [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b))
  }

  return { ensureBuiltinSource, sources, saveSource, removeSource, testSource, search, detail, install, categories }
}
