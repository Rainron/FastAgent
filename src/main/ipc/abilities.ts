import { normalizePageSize, pageOffset, resolvePage } from '../../shared/pagination'
import type { AbilityType, McpAbility, PageQuery, PluginQuery, SkillAbility } from '../../shared/types'
import { listCategories, searchPlugins } from '../plugins/catalog'
import { shell } from 'electron'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 能力总览与插件市场。 */
export function registerAbilitiesIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('abilities:list', () => ctx.listAbilities())
  handle('abilities:list-page', async (_event, query: PageQuery = {}) => {
    const items = await ctx.listAbilities()
    const pageSize = normalizePageSize(query.pageSize)
    const page = resolvePage(query.page, items.length, pageSize)
    const offset = pageOffset(page, pageSize)
    return { items: items.slice(offset, offset + pageSize), total: items.length, page, pageSize }
  })
  handle('abilities:get', async (_event, type: AbilityType, id: string) =>
    (await ctx.listAbilities()).find((item) => item.type === type && item.id === id) ?? null)
  handle('abilities:set-enabled', async (_event, type: AbilityType, id: string, enabled: boolean) => {
    if (type === 'skill') ctx.skillRegistry.setEnabled(id, enabled)
    else ctx.store.setMcpServerEnabled(id, enabled)
    return ctx.requireAbility(type, id)
  })
  handle('abilities:open-location', async (_event, type: AbilityType, id: string) => {
    const ability = await ctx.requireAbility(type, id)
    if (type === 'skill') return shell.openPath((ability as SkillAbility).localPath ?? ctx.appPaths.skillsDir)
    return shell.openPath((ability as McpAbility).cwd ?? ctx.appPaths.mcpDir)
  })
  handle('plugins:list', async (_event, query: PluginQuery = {}) =>
    ctx.pluginInstaller.decorate(searchPlugins(await ctx.catalogProvider.list(), query), await ctx.listAbilities()))
  handle('plugins:list-page', async (_event, query: PluginQuery = {}) => {
    const items = ctx.pluginInstaller.decorate(searchPlugins(await ctx.catalogProvider.list(), query), await ctx.listAbilities())
    const pageSize = normalizePageSize(query.pageSize)
    const page = resolvePage(query.page, items.length, pageSize)
    const offset = pageOffset(page, pageSize)
    return { items: items.slice(offset, offset + pageSize), total: items.length, page, pageSize }
  })
  handle('plugins:get', async (_event, id: string) => {
    const entry = await ctx.pluginInstaller.entry(id)
    return entry ? ctx.pluginInstaller.decorate([entry], await ctx.listAbilities())[0] : null
  })
  handle('plugins:install', (_event, id: string, config?: Record<string, string>) => ctx.pluginInstaller.install(id, config))
  handle('plugins:uninstall', (_event, id: string) => ctx.pluginInstaller.uninstall(id))
  handle('plugins:categories', async () => listCategories(await ctx.catalogProvider.list()))
  // Hub 与整包的通道单独成模块注册：registerIpc 已经过长，新通道不再往这个闭包里堆。
}
