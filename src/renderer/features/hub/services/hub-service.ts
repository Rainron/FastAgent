import type { HubInstallResult, HubListingDetail, HubQuery, HubSearchResult, HubSource, HubSourceInput } from '../../../../shared/types'

/** Hub 的 IPC 薄封装，页面不直接摸 window.fastAgent。 */
export const hubService = {
  sources: (): Promise<HubSource[]> => window.fastAgent.hub.sources(),
  saveSource: (input: HubSourceInput): Promise<HubSource> => window.fastAgent.hub.saveSource(input),
  removeSource: (id: string): Promise<void> => window.fastAgent.hub.removeSource(id),
  testSource: (id: string): Promise<HubSource> => window.fastAgent.hub.testSource(id),
  search: (query: HubQuery): Promise<HubSearchResult> => window.fastAgent.hub.search(query),
  detail: (sourceId: string, ref: string): Promise<HubListingDetail> => window.fastAgent.hub.detail(sourceId, ref),
  install: (sourceId: string, ref: string, config?: Record<string, string>): Promise<HubInstallResult> => window.fastAgent.hub.install(sourceId, ref, config),
  categories: (): Promise<string[]> => window.fastAgent.hub.categories()
}
