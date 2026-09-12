import type { Ability, HubQuery, HubSourceFailure } from '../../shared/types'
import { isNewerVersion } from '../plugins/semver'
import { sortListings } from './listing-filter'
import { listingId, type HubListingUndecorated, type RegistryProvider } from './types'

export interface AggregateResult {
  items: HubListingUndecorated[]
  failures: HubSourceFailure[]
}

export interface AggregateOptions {
  /** 单源超时。一个慢源不能把整页搜索拖住。 */
  timeoutMs?: number
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 超时既要真的 race，也要把 signal 传下去。
 * 只传 signal 拦不住忽略它的 provider，也拦不住 provider 内部同步的解压与解析；
 * 只 race 又不会去中断已经发出的请求。
 */
async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, outer: AbortSignal, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const scoped = AbortSignal.any([outer, controller.signal])
  const expired = new Promise<never>((_resolve, reject) => {
    scoped.addEventListener('abort', () => reject(new Error(`源响应超过 ${timeoutMs}ms 未返回`)), { once: true })
  })
  try {
    return await Promise.race([run(scoped), expired])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 多源并发搜索。任一源失败只记进 failures，其余结果照常返回——
 * 静默少结果比明确报错更难排查。
 */
export async function searchProviders(
  providers: RegistryProvider[],
  query: HubQuery,
  signal: AbortSignal,
  options: AggregateOptions = {}
): Promise<AggregateResult> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const settled = await Promise.all(providers.map(async (provider) => {
    try {
      const drafts = await withTimeout((scoped) => provider.search(query, scoped), signal, timeoutMs)
      return { provider, drafts }
    } catch (error) {
      return { provider, failure: { sourceId: provider.id, message: messageOf(error) } satisfies HubSourceFailure }
    }
  }))

  const items: HubListingUndecorated[] = []
  const failures: HubSourceFailure[] = []
  // 同一个 skill 名可能同时出现在多个源，按源顺序保留第一个：源列表的顺序就是用户设的优先级。
  const seen = new Set<string>()
  for (const entry of settled) {
    if (entry.failure) {
      failures.push(entry.failure)
      continue
    }
    for (const draft of entry.drafts ?? []) {
      const dedupeKey = `${draft.abilityType}::${draft.name}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      items.push({ ...draft, sourceId: entry.provider.id, id: listingId(entry.provider.id, draft.ref) })
    }
  }
  const sorted = sortListings(items, query.sort)
  return { items: query.limit ? sorted.slice(0, query.limit) : sorted, failures }
}

/**
 * 用本地能力库比对出安装态。目录本身不存安装信息，
 * 这一步与 PluginInstaller.decorate 同源，但按 sourceId + ref 而不是 pluginId 对齐。
 */
export function decorateListings(items: HubListingUndecorated[], abilities: Ability[]) {
  const byPluginId = new Map(abilities.filter((ability) => ability.pluginId).map((ability) => [ability.pluginId as string, ability]))
  const byName = new Map(abilities.map((ability) => [`${ability.type}::${ability.name}`, ability]))
  return items.map((item) => {
    const ability = byPluginId.get(listingId(item.sourceId, item.ref)) ?? byPluginId.get(item.ref) ?? byName.get(`${item.abilityType}::${item.name}`)
    return {
      ...item,
      installed: Boolean(ability),
      installedVersion: ability?.version,
      updateAvailable: Boolean(ability) && isNewerVersion(item.version, ability?.version),
      abilityId: ability?.id
    }
  })
}
