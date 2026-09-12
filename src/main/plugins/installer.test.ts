import { describe, expect, it } from 'vitest'
import { PluginInstaller, mcpServerIdFor, type PluginInstallerStore, type PluginSkillRegistry } from './installer'
import type { PluginCatalogEntry, PluginCatalogProvider } from './catalog'
import type { Ability, AbilityInstallMeta, AbilityType, LocalMcpServer, LocalMcpServerInput } from '../../shared/types'
import type { LocalSkillRecord, SkillImportOptions } from '../skill-registry'

const skillEntry: PluginCatalogEntry = {
  id: 'skill.demo',
  name: 'demo',
  displayName: 'Demo',
  description: '演示 Skill',
  abilityType: 'skill',
  version: '1.0.0',
  categories: ['开发'],
  tags: [],
  publishedAt: '2026-01-01T00:00:00.000Z',
  permissions: { runsLocalCode: false, networkAccess: false, fileAccess: false },
  configFields: [],
  payload: { kind: 'skill', files: { 'SKILL.md': '---\nname: demo\ndescription: 演示。\n---\n\n正文' } }
}

const mcpEntry: PluginCatalogEntry = {
  id: 'mcp.demo',
  name: 'demo-mcp',
  displayName: 'Demo MCP',
  description: '演示 MCP',
  abilityType: 'mcp',
  version: '2.0.0',
  categories: ['开发'],
  tags: [],
  publishedAt: '2026-01-01T00:00:00.000Z',
  permissions: { runsLocalCode: true, networkAccess: true, fileAccess: false },
  configFields: [
    { key: 'TOKEN', label: '令牌', target: 'env', required: true, secret: true },
    { key: 'Authorization', label: '鉴权头', target: 'header', required: false, secret: true },
    { key: 'cwd', label: '工作目录', target: 'cwd', required: false, secret: false }
  ],
  payload: { kind: 'mcp', transport: 'stdio', command: 'npx', args: ['-y', 'demo'], timeoutMs: 5000 }
}

function setup(entries: PluginCatalogEntry[] = [skillEntry, mcpEntry]) {
  const catalog: PluginCatalogProvider = { list: async () => entries }
  const servers = new Map<string, LocalMcpServerInput>()
  const meta = new Map<string, AbilityInstallMeta>()
  const removedStatus: string[] = []
  const skillDirs = new Map<string, Record<string, string>>()
  const skillOptions: SkillImportOptions[] = []

  const skills: PluginSkillRegistry = {
    installFiles: (files, options = {}) => {
      skillOptions.push(options)
      const name = /name:\s*(.+)/.exec(files['SKILL.md'])?.[1]?.trim() as string
      if (skillDirs.has(name) && options.onConflict !== 'overwrite') throw new Error(`Skill 已存在：${name}`)
      skillDirs.set(name, files)
      return { name, description: '演示。', filePath: `/skills/${name}/SKILL.md`, enabled: false } as LocalSkillRecord
    },
    remove: (name) => { skillDirs.delete(name) }
  }

  const key = (type: AbilityType, id: string) => `${type}::${id}`
  const store: PluginInstallerStore = {
    saveMcpServer: (input) => {
      servers.set(input.id, input)
      const { env: _env, headers: _headers, ...rest } = input
      return { ...rest, hasSecrets: Object.keys(input.env ?? {}).length > 0 || Object.keys(input.headers ?? {}).length > 0 } as LocalMcpServer
    },
    removeMcpServer: (id) => { servers.delete(id) },
    removeMcpStatus: (id) => { removedStatus.push(id) },
    listAbilityMeta: () => [...meta.values()],
    getAbilityMeta: (type, id) => meta.get(key(type, id)) ?? null,
    upsertAbilityMeta: (input) => {
      const now = '2026-08-31T00:00:00.000Z'
      const record: AbilityInstallMeta = {
        abilityType: input.abilityType,
        abilityId: input.abilityId,
        source: input.source,
        pluginId: input.pluginId ?? undefined,
        version: input.version ?? undefined,
        installedAt: input.installedAt ?? now,
        updatedAt: now,
        useCount: 0
      }
      meta.set(key(input.abilityType, input.abilityId), record)
      return record
    },
    removeAbilityMeta: (type, id) => { meta.delete(key(type, id)) }
  }

  return { installer: new PluginInstaller(catalog, skills, store), servers, meta, removedStatus, skillDirs, skillOptions }
}

describe('plugin installer', () => {
  it('安装 Skill 落盘并写来源元数据，安装后保持停用', async () => {
    const { installer, meta, skillDirs } = setup()
    const result = await installer.install('skill.demo')

    expect(result).toEqual({ abilityId: 'demo', abilityType: 'skill', status: 'installed' })
    expect(skillDirs.get('demo')?.['SKILL.md']).toContain('name: demo')
    expect(meta.get('skill::demo')).toMatchObject({ source: 'marketplace', pluginId: 'skill.demo', version: '1.0.0' })
  })

  it('同名 Skill 来自其它来源时拒绝覆盖，同插件重装才覆盖', async () => {
    const { installer, skillOptions } = setup()
    await installer.install('skill.demo')
    // 第一次安装写了 meta，重装被识别为同插件，允许覆盖
    await installer.install('skill.demo')
    expect(skillOptions).toEqual([{}, { onConflict: 'overwrite' }])
  })

  it('安装 MCP 时按 target 分发配置，缺必填项返回 config_required', async () => {
    const { installer, servers } = setup()
    const missing = await installer.install('mcp.demo', { cwd: 'D:/work' })
    expect(missing.status).toBe('config_required')
    expect(servers.get(mcpServerIdFor('mcp.demo'))).toMatchObject({ cwd: 'D:/work', enabled: false, env: {} })

    const ok = await installer.install('mcp.demo', { TOKEN: 'secret-value', Authorization: 'Bearer x' })
    expect(ok.status).toBe('installed')
    expect(servers.get(mcpServerIdFor('mcp.demo'))).toMatchObject({
      command: 'npx',
      args: ['-y', 'demo'],
      enabled: false,
      env: { TOKEN: 'secret-value' },
      headers: { Authorization: 'Bearer x' }
    })
  })

  it('卸载按类型清理能力、状态缓存与元数据', async () => {
    const { installer, servers, meta, removedStatus, skillDirs } = setup()
    await installer.install('skill.demo')
    await installer.install('mcp.demo', { TOKEN: 'v' })

    await installer.uninstall('skill.demo')
    expect(skillDirs.has('demo')).toBe(false)
    expect(meta.has('skill::demo')).toBe(false)

    await installer.uninstall('mcp.demo')
    expect(servers.size).toBe(0)
    expect(removedStatus).toEqual([mcpServerIdFor('mcp.demo')])
    expect(meta.size).toBe(0)
  })

  it('未安装的插件卸载报错，内置能力拒绝卸载', async () => {
    const { installer, meta } = setup()
    await expect(installer.uninstall('skill.demo')).rejects.toThrow('未安装')
    meta.set('skill::builtin-one', { abilityType: 'skill', abilityId: 'builtin-one', source: 'builtin', installedAt: '', updatedAt: '', useCount: 0 })
    expect(() => installer.uninstallAbility('skill', 'builtin-one')).toThrow('内置能力不能卸载')
  })

  it('decorate 用本地能力比对出安装态与更新提示，且不下发安装载荷', () => {
    const { installer } = setup()
    const abilities = [
      { id: 'demo', type: 'skill', pluginId: 'skill.demo', version: '0.9.0' } as unknown as Ability
    ]
    const [skill, mcp] = installer.decorate([skillEntry, mcpEntry], abilities)
    expect(skill).toMatchObject({ installed: true, installedVersion: '0.9.0', updateAvailable: true, abilityId: 'demo' })
    expect('payload' in skill).toBe(false)
    expect(mcp).toMatchObject({ installed: false, updateAvailable: false })
  })
})
