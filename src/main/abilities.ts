import type { Ability, AbilityInstallMeta, AbilitySource, AbilityStatus, AgentAbilityPolicy, LocalMcpServer, LocalSkillRecord, McpAbility, McpConnectionSnapshot, PluginConfigField, SkillAbility } from '../shared/types'
import { isNewerVersion } from './plugins/semver'

/** 无 meta 记录的存量能力按 imported 展示：无法区分新建与导入时，来源更需要用户警惕的一侧优先。 */
const FALLBACK_SOURCE: AbilitySource = 'imported'

export function emptyConnection(): McpConnectionSnapshot {
  return { state: 'unknown', error: null, toolCount: 0, resourceCount: 0, promptCount: 0, tools: [] }
}

function metaKey(type: Ability['type'], id: string) {
  return `${type}::${id}`
}

function directoryOf(filePath: string) {
  return filePath.replace(/[\\/]SKILL\.md$/i, '')
}

function humanize(name: string) {
  return name.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || name
}

/**
 * 状态推导的唯一实现。优先级：disabled > config_required > error > update_available > ready。
 * 禁用优先是因为禁用的能力不参与运行，不该用红色报错干扰用户。
 */
function deriveStatus(input: { enabled: boolean; configRequired?: boolean; failed?: boolean; updateAvailable?: boolean }): AbilityStatus {
  if (!input.enabled) return 'disabled'
  if (input.configRequired) return 'config_required'
  if (input.failed) return 'error'
  if (input.updateAvailable) return 'update_available'
  return 'ready'
}

/**
 * 有没有新版：内置 catalog 的版本只覆盖内置目录，Hub 装的能力靠「检查更新」写回的
 * latestVersion。两者任一比本地新就算有更新。
 */
function hasUpdate(source: AbilitySource, meta: AbilityInstallMeta | undefined, version: string | undefined, catalogVersion: string | undefined): boolean {
  if (source !== 'marketplace') return false
  return isNewerVersion(catalogVersion, version) || isNewerVersion(meta?.latestVersion, version)
}

export function buildSkillAbility(record: LocalSkillRecord, meta: AbilityInstallMeta | undefined, catalogVersion?: string): SkillAbility {
  const source = meta?.source ?? FALLBACK_SOURCE
  const version = record.version ?? meta?.version
  const updateAvailable = hasUpdate(source, meta, version, catalogVersion)
  return {
    id: record.name,
    name: record.name,
    displayName: humanize(record.name),
    description: record.description,
    type: 'skill',
    source,
    enabled: record.enabled,
    status: deriveStatus({ enabled: record.enabled, updateAvailable }),
    version,
    author: record.author,
    pluginId: meta?.pluginId,
    localPath: directoryOf(record.filePath),
    installedAt: meta?.installedAt,
    updatedAt: meta?.updatedAt,
    lastUsedAt: meta?.lastUsedAt,
    filePath: record.filePath,
    builtin: source === 'builtin'
  }
}

export function buildMcpAbility(
  server: LocalMcpServer,
  meta: AbilityInstallMeta | undefined,
  snapshot: McpConnectionSnapshot | undefined,
  missingRequiredConfig: boolean,
  catalogVersion?: string
): McpAbility {
  const source = meta?.source ?? FALLBACK_SOURCE
  const connection = snapshot ?? emptyConnection()
  const failed = connection.state === 'error'
  const updateAvailable = hasUpdate(source, meta, meta?.version, catalogVersion)
  const status = deriveStatus({ enabled: server.enabled, configRequired: missingRequiredConfig, failed, updateAvailable })
  return {
    id: server.id,
    name: server.name,
    displayName: server.name,
    type: 'mcp',
    source,
    enabled: server.enabled,
    status,
    version: meta?.version,
    pluginId: meta?.pluginId,
    installedAt: meta?.installedAt,
    updatedAt: meta?.updatedAt,
    lastUsedAt: meta?.lastUsedAt,
    error: failed && connection.error ? { message: connection.error } : undefined,
    transport: server.transport,
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    url: server.url,
    timeoutMs: server.timeoutMs,
    hasSecrets: server.hasSecrets,
    connection
  }
}

/**
 * 判断 MCP Server 是否缺必填配置。transport 本身的必填项（stdio 的 command、
 * HTTP 的 url）先看，再按插件声明的 configFields 逐项检查；args 无法回读，视为已满足。
 */
export function missingRequiredMcpConfig(
  server: Pick<LocalMcpServer, 'transport' | 'command' | 'url' | 'cwd'>,
  fields: PluginConfigField[],
  secrets: { env?: Record<string, string>; headers?: Record<string, string> } = {}
): boolean {
  if (server.transport === 'stdio' && !server.command?.trim()) return true
  if (server.transport === 'streamable_http' && !server.url?.trim()) return true
  return fields.some((field) => {
    if (!field.required) return false
    switch (field.target) {
      case 'env': return !secrets.env?.[field.key]?.trim()
      case 'header': return !secrets.headers?.[field.key]?.trim()
      case 'url': return !server.url?.trim()
      case 'command': return !server.command?.trim()
      case 'cwd': return !server.cwd?.trim()
      default: return false
    }
  })
}

export interface BuildAbilitiesInput {
  skills: LocalSkillRecord[]
  mcpServers: LocalMcpServer[]
  meta: AbilityInstallMeta[]
  snapshots: Array<{ serverId: string } & McpConnectionSnapshot>
  /** pluginId -> catalog 当前版本，用于判断「有更新」 */
  catalogVersions?: Record<string, string>
  /** 缺必填配置的 MCP Server id */
  missingConfigServerIds?: string[]
}

export function buildAbilities(input: BuildAbilitiesInput): Ability[] {
  const metaIndex = new Map(input.meta.map((item) => [metaKey(item.abilityType, item.abilityId), item]))
  const snapshotIndex = new Map(input.snapshots.map(({ serverId, ...snapshot }) => [serverId, snapshot as McpConnectionSnapshot]))
  const missing = new Set(input.missingConfigServerIds ?? [])
  const catalogVersion = (meta: AbilityInstallMeta | undefined) => (meta?.pluginId ? input.catalogVersions?.[meta.pluginId] : undefined)

  const skills = input.skills.map((record) => {
    const meta = metaIndex.get(metaKey('skill', record.name))
    return buildSkillAbility(record, meta, catalogVersion(meta))
  })
  const servers = input.mcpServers.map((server) => {
    const meta = metaIndex.get(metaKey('mcp', server.id))
    return buildMcpAbility(server, meta, snapshotIndex.get(server.id), missing.has(server.id), catalogVersion(meta))
  })
  return [...skills, ...servers]
}

/**
 * Agent 运行时可发现的能力入口。P0 只放行已启用的能力；
 * selected 分支留待「Agent 能力授权」落地，调用方届时不需要改。
 */
export function resolveAgentAbilities(_policy: AgentAbilityPolicy, abilities: Ability[]): Ability[] {
  return abilities.filter((ability) => ability.enabled)
}
