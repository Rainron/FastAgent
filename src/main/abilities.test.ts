import { describe, expect, it } from 'vitest'
import { buildAbilities, buildMcpAbility, buildSkillAbility, emptyConnection, missingRequiredMcpConfig, resolveAgentAbilities } from './abilities'
import type { AbilityInstallMeta, LocalMcpServer, LocalSkillRecord, McpConnectionSnapshot, PluginConfigField, SkillAbility } from '../shared/types'

function meta(patch: Partial<AbilityInstallMeta>): AbilityInstallMeta {
  return {
    abilityType: 'skill',
    abilityId: 'demo',
    source: 'marketplace',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    useCount: 0,
    ...patch
  }
}

const skill: LocalSkillRecord = { name: 'code-review', description: '审查代码。', filePath: '/root/skills/code-review/SKILL.md', enabled: true, version: '1.0.0', author: 'FastAgent' }

const server: LocalMcpServer = { id: 'srv-1', name: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'x'], enabled: true, timeoutMs: 30_000, hasSecrets: true }

function connection(patch: Partial<McpConnectionSnapshot>): McpConnectionSnapshot {
  return { ...emptyConnection(), ...patch }
}

describe('ability 聚合', () => {
  it('Skill 带上来源、版本、作者与目录', () => {
    const ability = buildSkillAbility(skill, meta({ abilityId: 'code-review', pluginId: 'skill.code-review', version: '1.0.0' }))
    expect(ability).toMatchObject({
      id: 'code-review',
      displayName: 'Code Review',
      type: 'skill',
      source: 'marketplace',
      version: '1.0.0',
      author: 'FastAgent',
      pluginId: 'skill.code-review',
      localPath: '/root/skills/code-review',
      status: 'ready',
      builtin: false
    })
  })

  it('无 meta 记录的存量能力按 imported 展示', () => {
    expect(buildSkillAbility(skill, undefined).source).toBe('imported')
  })

  it('状态优先级：disabled > config_required > error > update_available > ready', () => {
    const disabled = buildMcpAbility({ ...server, enabled: false }, meta({ abilityType: 'mcp' }), connection({ state: 'error', error: '连不上' }), true, '9.0.0')
    expect(disabled.status).toBe('disabled')

    const configRequired = buildMcpAbility(server, meta({ abilityType: 'mcp' }), connection({ state: 'error', error: '连不上' }), true, '9.0.0')
    expect(configRequired.status).toBe('config_required')

    const failed = buildMcpAbility(server, meta({ abilityType: 'mcp', version: '1.0.0' }), connection({ state: 'error', error: '连不上' }), false, '9.0.0')
    expect(failed.status).toBe('error')
    expect(failed.error).toEqual({ message: '连不上' })

    const outdated = buildMcpAbility(server, meta({ abilityType: 'mcp', version: '1.0.0' }), connection({ state: 'connected' }), false, '9.0.0')
    expect(outdated.status).toBe('update_available')

    const ready = buildMcpAbility(server, meta({ abilityType: 'mcp', version: '9.0.0' }), connection({ state: 'connected' }), false, '9.0.0')
    expect(ready.status).toBe('ready')
  })

  it('检查更新写回的最新版本也能推出「有更新」，与内置 catalog 无关', () => {
    const outdated = buildSkillAbility(skill, meta({ latestVersion: '2.0.0' }))
    expect(outdated.status).toBe('update_available')

    const current = buildSkillAbility(skill, meta({ latestVersion: '1.0.0' }))
    expect(current.status).toBe('ready')

    // 非 marketplace 来源不参与更新判断：本地创建的能力没有远端可对
    const created = buildSkillAbility(skill, meta({ source: 'created', latestVersion: '2.0.0' }))
    expect(created.status).toBe('ready')

    const mcpOutdated = buildMcpAbility(server, meta({ abilityType: 'mcp', version: '1.0.0', latestVersion: '1.5.0' }), connection({ state: 'connected' }), false)
    expect(mcpOutdated.status).toBe('update_available')
  })

  it('非 marketplace 来源不提示更新', () => {
    const created = buildSkillAbility(skill, meta({ abilityId: 'code-review', source: 'created' }), '9.9.9')
    expect(created.status).toBe('ready')
  })

  it('缺连接状态时按 unknown 展示且不报错', () => {
    const ability = buildMcpAbility(server, undefined, undefined, false)
    expect(ability.connection.state).toBe('unknown')
    expect(ability.status).toBe('ready')
    expect(ability.error).toBeUndefined()
  })

  it('buildAbilities 合并 Skill 与 MCP，并按 pluginId 取 catalog 版本', () => {
    const abilities = buildAbilities({
      skills: [skill],
      mcpServers: [server],
      meta: [
        meta({ abilityType: 'skill', abilityId: 'code-review', pluginId: 'p1', version: '1.0.0' }),
        meta({ abilityType: 'mcp', abilityId: 'srv-1', pluginId: 'p2', version: '1.0.0' })
      ],
      snapshots: [{ serverId: 'srv-1', ...connection({ state: 'connected', toolCount: 3 }) }],
      catalogVersions: { p2: '2.0.0' },
      missingConfigServerIds: []
    })
    expect(abilities.map((item) => item.type)).toEqual(['skill', 'mcp'])
    expect(abilities[1]).toMatchObject({ status: 'update_available', connection: { toolCount: 3 } })
  })
})

describe('MCP 必填配置判定', () => {
  const fields: PluginConfigField[] = [
    { key: 'TOKEN', label: '', target: 'env', required: true, secret: true },
    { key: 'Authorization', label: '', target: 'header', required: false, secret: true },
    { key: 'cwd', label: '', target: 'cwd', required: true, secret: false }
  ]

  it('transport 自身必填项缺失即判为需要配置', () => {
    expect(missingRequiredMcpConfig({ transport: 'stdio' }, [])).toBe(true)
    expect(missingRequiredMcpConfig({ transport: 'streamable_http' }, [])).toBe(true)
    expect(missingRequiredMcpConfig({ transport: 'streamable_http', url: 'https://x' }, [])).toBe(false)
  })

  it('按 configFields 检查 env / header / cwd', () => {
    expect(missingRequiredMcpConfig({ transport: 'stdio', command: 'npx', cwd: 'D:/a' }, fields, { env: {} })).toBe(true)
    expect(missingRequiredMcpConfig({ transport: 'stdio', command: 'npx' }, fields, { env: { TOKEN: 'v' } })).toBe(true)
    expect(missingRequiredMcpConfig({ transport: 'stdio', command: 'npx', cwd: 'D:/a' }, fields, { env: { TOKEN: 'v' } })).toBe(false)
  })
})

describe('resolveAgentAbilities', () => {
  it('只放行已启用的能力', () => {
    const enabled = buildSkillAbility(skill, undefined)
    const disabled = buildSkillAbility({ ...skill, name: 'other', enabled: false }, undefined)
    const resolved = resolveAgentAbilities({ mode: 'all_enabled', agentAbilityIds: [] }, [enabled, disabled])
    expect(resolved.map((item) => (item as SkillAbility).name)).toEqual(['code-review'])
  })
})
