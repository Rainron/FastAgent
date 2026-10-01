import type { LocalMcpServerInput, McpServerDetail, McpTestStatus } from '../../shared/types'
import { emptyConnection } from '../abilities'
import { logIntegrationError } from '../logging/logger'
import { parseMcpImport } from '../mcp-import'
import { redactSecrets } from '../secret-redaction'
import { dialog } from 'electron'
import { readFileSync } from 'node:fs'
import type { IpcRegistrar, MainContext } from '../app-context'

/** MCP Server 配置、连通性测试、工具启停与导入。 */
export function registerMcpIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('mcp:list', () => ctx.store.listMcpServers())
  handle('mcp:save', (_event, input) => {
    const previous = ctx.store.getAbilityMeta('mcp', input.id)
    const server = ctx.store.saveMcpServer(input)
    // 编辑已安装的市场 Server 时必须保留 plugin_id / version，否则会丢掉「打开能力」与更新检测。
    ctx.store.upsertAbilityMeta({
      abilityType: 'mcp',
      abilityId: server.id,
      source: previous?.source ?? 'created',
      pluginId: previous?.pluginId,
      version: previous?.version,
      installedAt: previous?.installedAt
    })
    return server
  })
  handle('mcp:set-enabled', (_event, id: string, enabled: boolean) => ctx.store.setMcpServerEnabled(id, enabled))
  handle('mcp:remove', (_event, id: string) => {
    ctx.store.removeMcpServer(id)
    ctx.store.removeMcpStatus(id)
    ctx.store.removeAbilityMeta('mcp', id)
  })
  handle('mcp:test', async (_event, id: string): Promise<McpTestStatus> => {
    const config = ctx.store.getMcpRuntimeConfig(id)
    if (!config) throw new Error(`MCP Server 不存在：${id}`)
    const { probeMcpServer } = await ctx.loadMcpRuntime()
    const snapshot = ctx.recordMcpStatus(id, await probeMcpServer(config))
    return { testedAt: snapshot.testedAt as string, ok: snapshot.state === 'connected', error: snapshot.error, toolCount: snapshot.toolCount, tools: snapshot.tools }
  })
  handle('mcp:test-config', async (_event, input: LocalMcpServerInput): Promise<McpTestStatus> => {
    // 草稿配置只做一次探测，不落库、不写状态缓存。
    const { probeMcpServer } = await ctx.loadMcpRuntime()
    const probe = await probeMcpServer(input)
    const secrets = [...Object.values(input.env ?? {}), ...Object.values(input.headers ?? {})]
    const redacted = redactSecrets(probe.error, secrets)
    // 草稿配置不落库，走不到 ctx.recordMcpStatus，这里单独记一次。
    if (!probe.ok) logIntegrationError({ service: 'mcp', endpoint: `${input.name || '(草稿)'} (未保存)`, message: redacted ?? '连接失败' })
    return {
      testedAt: new Date().toISOString(),
      ok: probe.ok,
      error: redacted,
      toolCount: probe.tools.length,
      tools: probe.tools.map((tool) => ({ name: tool.name, description: tool.description, annotations: tool.annotations }))
    }
  })
  handle('mcp:status', () => ctx.store.listMcpStatus().map(({ serverId, ...snapshot }) => ({
    id: serverId,
    testedAt: snapshot.testedAt ?? '',
    ok: snapshot.state === 'connected',
    error: snapshot.error,
    toolCount: snapshot.toolCount,
    tools: snapshot.tools
  })))
  handle('mcp:detail', (_event, id: string): McpServerDetail => {
    const server = ctx.store.listMcpServers().find((item) => item.id === id)
    if (!server) throw new Error(`MCP Server 不存在：${id}`)
    const meta = ctx.store.getAbilityMeta('mcp', id)
    const secrets = ctx.mcpRuntimeSecrets(id)
    // 只回传 key 与是否有值，密钥值一律不出主进程。
    const describe = (values: Record<string, string> | undefined) =>
      Object.entries(values ?? {}).map(([key, value]) => ({ key, hasValue: Boolean(value?.trim()) }))
    return {
      server,
      connection: ctx.store.getMcpStatus(id) ?? emptyConnection(),
      source: meta?.source ?? 'imported',
      pluginId: meta?.pluginId,
      installedAt: meta?.installedAt,
      envKeys: describe(secrets.env),
      headerKeys: describe(secrets.headers)
    }
  })
  handle('mcp:import', async () => {
    const result = await dialog.showOpenDialog(ctx.mainWindow!, {
      title: '导入 MCP Server 配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const inputs = parseMcpImport(readFileSync(result.filePaths[0], 'utf8'))
    return inputs.map((input: LocalMcpServerInput) => {
      const server = ctx.store.saveMcpServer(input)
      ctx.store.upsertAbilityMeta({ abilityType: 'mcp', abilityId: server.id, source: 'imported' })
      return server
    })
  })
}
