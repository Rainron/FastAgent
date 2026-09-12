import type { HubQuery, HubSource } from '../../../shared/types'
import { fetchJson, type FetchLimits } from '../fetcher'
import { matchesHubQuery, sortListings } from '../listing-filter'
import { parseRegistryResponse, type ParsedRegistryServer } from '../server-json'
import type { HubListingDetailDraft, HubListingDraft, InstallPayload, RegistryProvider } from '../types'

export const DEFAULT_MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io'

export interface McpRegistryDeps {
  fetchImpl?: typeof fetch
  limits?: Partial<FetchLimits>
  /** 单次搜索取多少条。registry 按游标翻页，Hub 只展示第一页。 */
  pageSize?: number
}

/**
 * 官方 MCP Registry。搜索走服务端 `search` 参数，
 * 本地再过一遍 matchesHubQuery：服务端只按名称匹配，类型/分类这类筛选它不认。
 */
export class McpRegistryProvider implements RegistryProvider {
  readonly id: string
  readonly kind = 'mcp-registry' as const
  readonly name: string
  private readonly baseUrl: string
  private readonly cache = new Map<string, ParsedRegistryServer>()

  constructor(source: HubSource, private readonly deps: McpRegistryDeps = {}) {
    this.id = source.id
    this.name = source.name
    this.baseUrl = (source.url?.trim() || DEFAULT_MCP_REGISTRY_URL).replace(/\/$/, '')
  }

  private async load(query: HubQuery, signal: AbortSignal): Promise<ParsedRegistryServer[]> {
    const url = new URL(`${this.baseUrl}/v0/servers`)
    url.searchParams.set('limit', String(this.deps.pageSize ?? 50))
    const keyword = query.keyword?.trim()
    if (keyword) url.searchParams.set('search', keyword)
    const body = await fetchJson<unknown>(url.href, { signal, limits: this.deps.limits, fetchImpl: this.deps.fetchImpl })
    const parsed = parseRegistryResponse(body)
    // 详情与安装按 ref 回查，避免为了一条记录再打一次网络。
    for (const item of parsed) this.cache.set(item.detail.ref, item)
    return parsed
  }

  async search(query: HubQuery, signal: AbortSignal): Promise<HubListingDraft[]> {
    // registry 只提供 MCP，按别的能力类型筛选时直接不出结果，不必打网络。
    if (query.abilityType && query.abilityType !== 'mcp') return []
    const parsed = await this.load(query, signal)
    const matched = parsed.map((item) => item.detail).filter((detail) => matchesHubQuery(detail, { ...query, keyword: undefined }))
    const sorted = sortListings(matched, query.sort)
    return query.limit ? sorted.slice(0, query.limit) : sorted
  }

  private async require(ref: string, signal: AbortSignal): Promise<ParsedRegistryServer> {
    const cached = this.cache.get(ref)
    if (cached) return cached
    const found = (await this.load({ keyword: ref }, signal)).find((item) => item.detail.ref === ref)
    if (!found) throw new Error(`${this.name} 上不存在条目：${ref}`)
    return found
  }

  async detail(ref: string, signal: AbortSignal): Promise<HubListingDetailDraft> {
    return (await this.require(ref, signal)).detail
  }

  async fetchPayload(ref: string, signal: AbortSignal): Promise<InstallPayload[]> {
    return (await this.require(ref, signal)).payloads
  }
}
