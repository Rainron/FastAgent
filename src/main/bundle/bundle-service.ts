import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AbilityInstallMeta, BundleContents, BundleEntryMeta, BundleExportOptions, BundleImportPlan, HubInstalledAbility, LocalCliTool, LocalMcpServerInput } from '../../shared/types'
import type { LocalStore } from '../local-store'
import type { LocalSkillRegistry } from '../skill-registry'
import { buildBundle, readBundle } from './ability-bundle'

export type { BundleExportOptions, BundleImportPlan }

export interface BundleServiceDeps {
  store(): LocalStore
  skillRegistry(): LocalSkillRegistry
  appVersion?: string
}

function metaOf(meta: AbilityInstallMeta | undefined): BundleEntryMeta | undefined {
  if (!meta) return undefined
  return { source: meta.source, sourceId: meta.sourceId, pluginId: meta.pluginId, version: meta.version }
}

export function createBundleService({ store, skillRegistry }: BundleServiceDeps) {
  function metaIndex() {
    return new Map(store().listAbilityMeta().map((item) => [`${item.abilityType}::${item.abilityId}`, item]))
  }

  function skillFiles(name: string): Record<string, string> {
    const directory = skillRegistry().directoryOf(name)
    const files: Record<string, string> = {}
    for (const node of skillRegistry().files(name)) {
      files[node.path] = readFileSync(join(directory, node.path), 'utf8')
    }
    return files
  }

  /**
   * 导出。密钥只有在 secrets 不是 omit 时才从 store 解出来——
   * 默认档下解密都不发生，产物里不可能出现密钥。
   */
  function exportBundle(options: BundleExportOptions): Uint8Array {
    const meta = metaIndex()
    const includeSecrets = options.secrets !== 'omit'
    const skills = skillRegistry().list()
      .filter((skill) => !options.skillNames || options.skillNames.includes(skill.name))
      .map((skill) => ({
        name: skill.name,
        enabled: skill.enabled,
        files: skillFiles(skill.name),
        meta: metaOf(meta.get(`skill::${skill.name}`))
      }))

    const mcpServers = store().listMcpServers()
      .filter((server) => !options.mcpIds || options.mcpIds.includes(server.id))
      .map((server) => {
        const runtime = includeSecrets ? store().getMcpRuntimeConfig(server.id) : null
        const base: LocalMcpServerInput = { ...server }
        return {
          server: runtime ? { ...base, env: runtime.env, headers: runtime.headers } : base,
          disabledTools: store().listDisabledMcpTools(server.id),
          meta: metaOf(meta.get(`mcp::${server.id}`))
        }
      })

    const cliTools = store().listCliTools()
      .filter((tool) => !options.cliIds || options.cliIds.includes(tool.id))
      .map((tool) => ({ tool, meta: metaOf(meta.get(`cli::${tool.id}`)) }))

    return buildBundle({
      secrets: options.secrets,
      passphrase: options.passphrase,
      skills,
      mcpServers,
      cliTools
    })
  }

  /** 单个 Skill 的导出：形态与整包一致，只是内容裁到一条，导入端不需要另一套解析。 */
  function exportSkill(name: string): Uint8Array {
    return exportBundle({ skillNames: [name], mcpIds: [], cliIds: [], secrets: 'omit' })
  }

  function preview(archive: Uint8Array, passphrase?: string): BundleContents {
    return readBundle(archive, passphrase)
  }

  /**
   * 按勾选逐条落地。与所有其它安装路径一致：导入进来一律停用，
   * 整包里记的 enabled 只作为展示信息，不直接生效。
   */
  function importBundle(archive: Uint8Array, plan: BundleImportPlan): HubInstalledAbility[] {
    const contents = readBundle(archive, plan.passphrase)
    const installed: HubInstalledAbility[] = []

    for (const skill of contents.skills) {
      if (!plan.skillNames.includes(skill.name)) continue
      const record = skillRegistry().installFiles(skill.files, { onConflict: plan.onConflict })
      store().upsertAbilityMeta({
        abilityType: 'skill',
        abilityId: record.name,
        source: 'imported',
        pluginId: skill.meta?.pluginId,
        sourceId: skill.meta?.sourceId,
        version: skill.meta?.version
      })
      installed.push({ abilityId: record.name, abilityType: 'skill', status: 'installed' })
    }

    for (const entry of contents.mcpServers) {
      if (!plan.mcpIds.includes(entry.server.id)) continue
      const hasSecrets = Object.keys(entry.server.env ?? {}).length > 0 || Object.keys(entry.server.headers ?? {}).length > 0
      store().saveMcpServer({ ...entry.server, enabled: false })
      for (const tool of entry.disabledTools) store().setMcpToolEnabled(entry.server.id, tool, false)
      store().upsertAbilityMeta({
        abilityType: 'mcp',
        abilityId: entry.server.id,
        source: 'imported',
        pluginId: entry.meta?.pluginId,
        sourceId: entry.meta?.sourceId,
        version: entry.meta?.version
      })
      // 整包不带密钥时导进来的 Server 必然缺配置，状态由能力页按 configFields 推导，这里只如实标注。
      installed.push({ abilityId: entry.server.id, abilityType: 'mcp', status: hasSecrets ? 'installed' : 'config_required' })
    }

    for (const entry of contents.cliTools) {
      if (!plan.cliIds.includes(entry.tool.id)) continue
      const tool: LocalCliTool = { ...entry.tool, enabled: false }
      store().saveCliTool(tool)
      store().upsertAbilityMeta({
        abilityType: 'cli',
        abilityId: tool.id,
        source: 'imported',
        pluginId: entry.meta?.pluginId,
        sourceId: entry.meta?.sourceId,
        version: entry.meta?.version
      })
      installed.push({ abilityId: tool.id, abilityType: 'cli', status: 'installed' })
    }

    return installed
  }

  return { exportBundle, exportSkill, preview, importBundle }
}
