import type { Ability, AbilityInstallMeta, AbilitySource, AbilityType, LocalMcpServer, LocalMcpServerInput, Plugin, PluginConfigField, PluginInstallResult } from '../../shared/types'
import type { LocalSkillRecord, SkillImportOptions } from '../skill-registry'
import type { PluginCatalogEntry, PluginCatalogProvider, PluginPayload } from './catalog'
import { isNewerVersion } from './semver'

export interface PluginInstallerStore {
  saveMcpServer(input: LocalMcpServerInput): LocalMcpServer
  removeMcpServer(id: string): void
  removeMcpStatus(serverId: string): void
  listAbilityMeta(): AbilityInstallMeta[]
  getAbilityMeta(abilityType: AbilityType, abilityId: string): AbilityInstallMeta | null
  upsertAbilityMeta(input: { abilityType: AbilityType; abilityId: string; source: AbilitySource; pluginId?: string | null; version?: string | null; installedAt?: string }): AbilityInstallMeta
  removeAbilityMeta(abilityType: AbilityType, abilityId: string): void
}

export interface PluginSkillRegistry {
  installFiles(files: Record<string, string>, options?: SkillImportOptions): LocalSkillRecord
  remove(name: string): void
}

/** MCP 插件安装出来的 Server id，重装同一插件复用同一条记录。 */
export function mcpServerIdFor(pluginId: string) {
  return `plugin-${pluginId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
}

/** 把用户填的配置按 target 分发到 env / header / 命令行各处；Hub 安装路径复用同一实现。 */
export function applyConfig(payload: Extract<PluginPayload, { kind: 'mcp' }>, fields: PluginConfigField[], config: Record<string, string>) {
  const env: Record<string, string> = {}
  const headers: Record<string, string> = {}
  let { command, args, cwd, url } = payload
  const missing: string[] = []
  for (const field of fields) {
    const value = config[field.key]?.trim()
    if (!value) {
      if (field.required) missing.push(field.key)
      continue
    }
    switch (field.target) {
      case 'env': env[field.key] = value; break
      case 'header': headers[field.key] = value; break
      case 'url': url = value; break
      case 'command': command = value; break
      case 'args': args = [...(args ?? []), value]; break
      case 'cwd': cwd = value; break
    }
  }
  return { env, headers, command, args, cwd, url, missing }
}

export class PluginInstaller {
  constructor(
    private readonly catalog: PluginCatalogProvider,
    private readonly skills: PluginSkillRegistry,
    private readonly store: PluginInstallerStore
  ) {}

  async entry(pluginId: string): Promise<PluginCatalogEntry | null> {
    return (await this.catalog.list()).find((item) => item.id === pluginId) ?? null
  }

  async install(pluginId: string, config: Record<string, string> = {}): Promise<PluginInstallResult> {
    const entry = await this.entry(pluginId)
    if (!entry) throw new Error(`插件不存在：${pluginId}`)
    return entry.payload.kind === 'skill'
      ? this.installSkill(entry, entry.payload)
      : this.installMcp(entry, entry.payload, config)
  }

  private installSkill(entry: PluginCatalogEntry, payload: Extract<PluginPayload, { kind: 'skill' }>): PluginInstallResult {
    // 只有确认是同一插件的重装才允许覆盖，避免顶掉用户自建的同名 Skill。
    const previous = this.store.getAbilityMeta('skill', entry.name)
    const options: SkillImportOptions = previous?.pluginId === entry.id ? { onConflict: 'overwrite' } : {}
    const record = this.skills.installFiles(payload.files, options)
    this.store.upsertAbilityMeta({ abilityType: 'skill', abilityId: record.name, source: 'marketplace', pluginId: entry.id, version: entry.version })
    return { abilityId: record.name, abilityType: 'skill', status: 'installed' }
  }

  private installMcp(entry: PluginCatalogEntry, payload: Extract<PluginPayload, { kind: 'mcp' }>, config: Record<string, string>): PluginInstallResult {
    const applied = applyConfig(payload, entry.configFields, config)
    const id = mcpServerIdFor(entry.id)
    // 安装与启用分离：任何安装路径落地都是停用状态，必须用户显式启用。
    const input: LocalMcpServerInput = {
      id,
      name: entry.name,
      transport: payload.transport,
      command: applied.command,
      args: applied.args,
      cwd: applied.cwd,
      url: applied.url,
      enabled: false,
      timeoutMs: payload.timeoutMs,
      env: applied.env,
      headers: applied.headers
    }
    this.store.saveMcpServer(input)
    this.store.upsertAbilityMeta({ abilityType: 'mcp', abilityId: id, source: 'marketplace', pluginId: entry.id, version: entry.version })
    return { abilityId: id, abilityType: 'mcp', status: applied.missing.length ? 'config_required' : 'installed' }
  }

  async uninstall(pluginId: string): Promise<void> {
    const meta = this.store.listAbilityMeta().find((item) => item.pluginId === pluginId)
    if (!meta) throw new Error(`插件未安装：${pluginId}`)
    this.uninstallAbility(meta.abilityType, meta.abilityId)
  }

  /** 能力页与插件页共用的卸载实现；内置能力拒绝卸载。 */
  uninstallAbility(abilityType: AbilityType, abilityId: string) {
    const meta = this.store.getAbilityMeta(abilityType, abilityId)
    if (meta?.source === 'builtin') throw new Error('内置能力不能卸载')
    if (abilityType === 'skill') {
      this.skills.remove(abilityId)
    } else {
      this.store.removeMcpServer(abilityId)
      this.store.removeMcpStatus(abilityId)
    }
    this.store.removeAbilityMeta(abilityType, abilityId)
  }

  /** 用本地能力库比对出安装态；catalog 本身不存安装信息。 */
  decorate(entries: PluginCatalogEntry[], abilities: Ability[]): Plugin[] {
    const byPlugin = new Map(abilities.filter((ability) => ability.pluginId).map((ability) => [ability.pluginId as string, ability]))
    return entries.map(({ payload: _payload, ...plugin }) => {
      const ability = byPlugin.get(plugin.id)
      return {
        ...plugin,
        installed: Boolean(ability),
        installedVersion: ability?.version,
        updateAvailable: Boolean(ability) && isNewerVersion(plugin.version, ability?.version),
        abilityId: ability?.id
      }
    })
  }
}
