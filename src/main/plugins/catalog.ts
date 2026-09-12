import type { AbilityType, Plugin, PluginQuery } from '../../shared/types'
import { builtinCatalog } from './catalog-data'

/** 安装载荷只在主进程使用，不随 Plugin 下发到渲染进程。 */
export type PluginPayload =
  | { kind: 'skill'; files: Record<string, string> }
  | {
      kind: 'mcp'
      transport: 'stdio' | 'streamable_http'
      command?: string
      args?: string[]
      cwd?: string
      url?: string
      timeoutMs: number
    }

export interface PluginCatalogEntry extends Omit<Plugin, 'installed' | 'installedVersion' | 'updateAvailable' | 'abilityId'> {
  payload: PluginPayload
}

export interface PluginCatalogProvider {
  list(): Promise<PluginCatalogEntry[]>
}

/** 内置 catalog 随包发布；换远端 registry 时只替换这个实现。 */
export class BuiltinCatalogProvider implements PluginCatalogProvider {
  constructor(private readonly entries: PluginCatalogEntry[] = builtinCatalog) {}

  async list(): Promise<PluginCatalogEntry[]> {
    return this.entries
  }
}

export function listCategories(entries: PluginCatalogEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => entry.categories))].sort((a, b) => a.localeCompare(b))
}

function matchesKeyword(entry: PluginCatalogEntry, keyword: string) {
  const haystack = [entry.name, entry.displayName, entry.description, entry.author ?? '', ...entry.tags, ...entry.categories]
    .join(' ')
    .toLowerCase()
  return haystack.includes(keyword)
}

function sortEntries(entries: PluginCatalogEntry[], sort: PluginQuery['sort']) {
  const byName = (a: PluginCatalogEntry, b: PluginCatalogEntry) => a.displayName.localeCompare(b.displayName)
  const copy = [...entries]
  switch (sort) {
    case 'trending':
      return copy.sort((a, b) => (b.trending ?? 0) - (a.trending ?? 0) || byName(a, b))
    case 'latest':
      return copy.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || byName(a, b))
    case 'name':
      return copy.sort(byName)
    default:
      return copy.sort((a, b) =>
        Number(Boolean(b.featured)) - Number(Boolean(a.featured))
        || (b.downloadCount ?? 0) - (a.downloadCount ?? 0)
        || byName(a, b))
  }
}

export function searchPlugins(entries: PluginCatalogEntry[], query: PluginQuery = {}): PluginCatalogEntry[] {
  const keyword = query.keyword?.trim().toLowerCase()
  const abilityType: AbilityType | undefined = query.abilityType
  const filtered = entries.filter((entry) => {
    if (abilityType && entry.abilityType !== abilityType) return false
    if (query.category && !entry.categories.includes(query.category)) return false
    if (keyword && !matchesKeyword(entry, keyword)) return false
    return true
  })
  return sortEntries(filtered, query.sort)
}
