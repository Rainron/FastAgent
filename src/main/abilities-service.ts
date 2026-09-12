import type { Ability, AbilityType, McpConnectionSnapshot } from '../shared/types'
import { buildAbilities, missingRequiredMcpConfig } from './abilities'
import type { LocalStore } from './local-store'
import { logIntegrationError } from './logging/logger'
import type { McpProbeResult } from './mcp-manager'
import type { BuiltinCatalogProvider } from './plugins/catalog'
import { redactSecrets } from './secret-redaction'
import type { LocalSkillRegistry } from './skill-registry'

/** store 与 skillRegistry 在 app.whenReady 里才赋值，用取值函数拿最新引用，避免捕获到 undefined。 */
export interface AbilitiesDeps {
  store(): LocalStore
  skillRegistry(): LocalSkillRegistry
  catalogProvider: BuiltinCatalogProvider
}

export function createAbilitiesService({ store, skillRegistry, catalogProvider }: AbilitiesDeps) {
  /** 解密后的 env/headers 只在主进程用于「缺必填配置」判定与错误脱敏，不出 IPC。 */
  function mcpRuntimeSecrets(id: string) {
    try {
      const config = store().getMcpRuntimeConfig(id)
      return { env: config?.env ?? {}, headers: config?.headers ?? {} }
    } catch {
      // 换机器后解不开密钥，按「无密钥」处理，不阻断能力列表。
      return {} as { env?: Record<string, string>; headers?: Record<string, string> }
    }
  }

  function secretValuesFor(id: string) {
    const secrets = mcpRuntimeSecrets(id)
    return [...Object.values(secrets.env ?? {}), ...Object.values(secrets.headers ?? {})]
  }

  /** 能力列表的唯一出口：Skill 目录 + MCP 表 + meta + 连接状态缓存 + catalog 版本。 */
  async function listAbilities(): Promise<Ability[]> {
    const entries = await catalogProvider.list()
    const meta = store().listAbilityMeta()
    const servers = store().listMcpServers()
    const pluginIdOf = (serverId: string) => meta.find((item) => item.abilityType === 'mcp' && item.abilityId === serverId)?.pluginId
    const missingConfigServerIds = servers
      .filter((server) => {
        const fields = entries.find((entry) => entry.id === pluginIdOf(server.id))?.configFields ?? []
        return missingRequiredMcpConfig(server, fields, mcpRuntimeSecrets(server.id))
      })
      .map((server) => server.id)
    return buildAbilities({
      skills: skillRegistry().list(),
      mcpServers: servers,
      meta,
      snapshots: store().listMcpStatus(),
      catalogVersions: Object.fromEntries(entries.map((entry) => [entry.id, entry.version])),
      missingConfigServerIds
    })
  }

  async function requireAbility(type: AbilityType, id: string) {
    const ability = (await listAbilities()).find((item) => item.type === type && item.id === id)
    if (!ability) throw new Error(`能力不存在：${id}`)
    return ability
  }

  /** 探测结果落 SQLite，重启后概览页的「运行状态」仍然可信；错误消息先脱敏。 */
  function recordMcpStatus(id: string, probe: McpProbeResult): McpConnectionSnapshot {
    // 探测与建连的失败都汇到这里，是记 MCP 侧问题唯一需要埋点的地方。
    const redacted = redactSecrets(probe.error, secretValuesFor(id))
    if (!probe.ok) logIntegrationError({ service: 'mcp', endpoint: id, message: redacted ?? '连接失败' })
    return store().setMcpStatus(id, {
      state: probe.ok ? 'connected' : 'error',
      testedAt: new Date().toISOString(),
      error: redacted,
      toolCount: probe.tools.length,
      resourceCount: probe.resourceCount,
      promptCount: probe.promptCount,
      tools: probe.tools.map((tool) => ({ name: tool.name, description: tool.description, annotations: tool.annotations }))
    })
  }

  /** 目录/表里已有但 meta 表没有的能力，启动时补一条来源记录。 */
  function backfillAbilityMeta() {
    const skills = skillRegistry().list().map((skill) => {
      let installedAt: string | undefined
      try { installedAt = skillRegistry().installedAt(skill.name) } catch { installedAt = undefined }
      return { abilityType: 'skill' as const, abilityId: skill.name, installedAt }
    })
    const servers = store().listMcpServerTimestamps().map((item) => ({ abilityType: 'mcp' as const, abilityId: item.id, installedAt: item.updatedAt }))
    store().backfillAbilityMeta([...skills, ...servers])
  }

  return { mcpRuntimeSecrets, listAbilities, requireAbility, recordMcpStatus, backfillAbilityMeta }
}
