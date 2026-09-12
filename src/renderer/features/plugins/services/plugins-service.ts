import type { PageResult, Plugin, PluginDetail, PluginInstallResult, PluginQuery } from '../../../../shared/types'

export const pluginsService = {
  list: (query?: PluginQuery): Promise<Plugin[]> => window.fastAgent.plugins.list(query),
  listPage: (query?: PluginQuery): Promise<PageResult<Plugin>> => window.fastAgent.plugins.listPage(query),
  get: (id: string): Promise<PluginDetail | null> => window.fastAgent.plugins.get(id),
  install: (id: string, config?: Record<string, string>): Promise<PluginInstallResult> => window.fastAgent.plugins.install(id, config),
  uninstall: (id: string) => window.fastAgent.plugins.uninstall(id),
  categories: (): Promise<string[]> => window.fastAgent.plugins.categories()
}
