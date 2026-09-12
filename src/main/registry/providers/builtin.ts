import type { HubQuery } from '../../../shared/types'
import { listCategories, searchPlugins, type PluginCatalogEntry, type PluginCatalogProvider } from '../../plugins/catalog'
import type { HubListingDetailDraft, HubListingDraft, InstallPayload, RegistryProvider } from '../types'

export const BUILTIN_SOURCE_ID = 'builtin'

function toDraft(entry: PluginCatalogEntry): HubListingDraft {
  const { payload: _payload, readme: _readme, id, ...rest } = entry
  return { ...rest, ref: id }
}

/** 内置目录随包发布，条目自带安装载荷，因此 fetchPayload 不出网。 */
export class BuiltinRegistryProvider implements RegistryProvider {
  readonly id = BUILTIN_SOURCE_ID
  readonly kind = 'builtin' as const
  readonly name = '内置目录'

  constructor(private readonly catalog: PluginCatalogProvider) {}

  private async require(ref: string): Promise<PluginCatalogEntry> {
    const entry = (await this.catalog.list()).find((item) => item.id === ref)
    if (!entry) throw new Error(`内置目录里不存在条目：${ref}`)
    return entry
  }

  async search(query: HubQuery): Promise<HubListingDraft[]> {
    const matched = searchPlugins(await this.catalog.list(), query)
    const drafts = matched.map(toDraft)
    return query.limit ? drafts.slice(0, query.limit) : drafts
  }

  async detail(ref: string): Promise<HubListingDetailDraft> {
    const entry = await this.require(ref)
    return {
      ...toDraft(entry),
      readme: entry.readme,
      contents: [{ kind: entry.abilityType, name: entry.name, description: entry.description }]
    }
  }

  async fetchPayload(ref: string): Promise<InstallPayload[]> {
    const entry = await this.require(ref)
    return [entry.payload.kind === 'skill' ? entry.payload : { ...entry.payload, name: entry.name }]
  }

  async categories(): Promise<string[]> {
    return listCategories(await this.catalog.list())
  }
}
