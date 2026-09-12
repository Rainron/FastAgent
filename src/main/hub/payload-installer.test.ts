import { describe, expect, it, vi } from 'vitest'
import type { AbilityInstallMeta, AbilityType, LocalMcpServer, LocalMcpServerInput } from '../../shared/types'
import type { InstallPayload } from '../registry/types'
import { hubMcpServerId, hubPluginId, installPayloads, type PayloadInstallerDeps } from './payload-installer'

function skillPayload(name: string): InstallPayload {
  return { kind: 'skill', files: { 'SKILL.md': `---\nname: ${name}\ndescription: 描述\n---\n\n正文\n` } }
}

function makeDeps(overrides: { meta?: AbilityInstallMeta | null } = {}) {
  const savedServers: LocalMcpServerInput[] = []
  const savedMeta: Array<Record<string, unknown>> = []
  const deps: PayloadInstallerDeps = {
    skills: {
      installFiles: vi.fn((files: Record<string, string>) => ({
        name: files['SKILL.md'].match(/^name:\s*(.+)$/m)?.[1] ?? 'unknown',
        description: '描述',
        filePath: '/skills/x/SKILL.md',
        enabled: false
      }))
    },
    store: {
      saveMcpServer: vi.fn((input: LocalMcpServerInput) => { savedServers.push(input); return input as LocalMcpServer }),
      getAbilityMeta: vi.fn((_type: AbilityType, _id: string) => overrides.meta ?? null),
      upsertAbilityMeta: vi.fn((input) => { savedMeta.push(input); return input as unknown as AbilityInstallMeta })
    }
  }
  return { deps, savedServers, savedMeta }
}

describe('hubMcpServerId', () => {
  it('同一条目的同一台 Server 得到稳定 id', () => {
    expect(hubMcpServerId('team', 'plugins/kit', 'linter')).toBe(hubMcpServerId('team', 'plugins/kit', 'linter'))
  })

  it('清掉 id 里不安全的字符', () => {
    expect(hubMcpServerId('team/x', 'a b', 'c:d')).toMatch(/^hub-team-x-a-b-c-d-[0-9a-f]{8}$/)
  })

  it('不同源的同名条目不撞 id', () => {
    expect(hubMcpServerId('a', 'kit', 's')).not.toBe(hubMcpServerId('b', 'kit', 's'))
  })

  it('清洗后同形的中文源不撞 id', () => {
    expect(hubMcpServerId('团队源', 'kit', 's')).not.toBe(hubMcpServerId('个人源', 'kit', 's'))
  })
})

describe('installPayloads', () => {
  const context = { sourceId: 'team', ref: 'plugins/kit', version: '1.0.0' }

  it('Skill 落地并记来源，安装后保持停用', () => {
    const { deps, savedMeta } = makeDeps()
    const result = installPayloads([skillPayload('alpha')], context, deps)
    expect(result).toEqual([{ abilityId: 'alpha', abilityType: 'skill', status: 'installed' }])
    expect(savedMeta[0]).toMatchObject({ abilityType: 'skill', abilityId: 'alpha', source: 'marketplace', pluginId: 'team::plugins/kit', sourceId: 'team', version: '1.0.0' })
  })

  it('同一条目重装才允许覆盖同名 Skill', () => {
    const { deps } = makeDeps({ meta: { abilityType: 'skill', abilityId: 'alpha', source: 'marketplace', pluginId: hubPluginId('team', 'plugins/kit'), installedAt: '', updatedAt: '', useCount: 0 } })
    installPayloads([skillPayload('alpha')], context, deps)
    expect(deps.skills.installFiles).toHaveBeenCalledWith(expect.anything(), { onConflict: 'overwrite' })
  })

  it('别处来的同名 Skill 不覆盖', () => {
    const { deps } = makeDeps({ meta: { abilityType: 'skill', abilityId: 'alpha', source: 'created', installedAt: '', updatedAt: '', useCount: 0 } })
    installPayloads([skillPayload('alpha')], context, deps)
    expect(deps.skills.installFiles).toHaveBeenCalledWith(expect.anything(), {})
  })

  it('MCP 落地后是停用状态', () => {
    const { deps, savedServers } = makeDeps()
    const payload: InstallPayload = { kind: 'mcp', name: 'linter', transport: 'stdio', command: 'linter-server', timeoutMs: 10_000 }
    const result = installPayloads([payload], context, deps)
    expect(savedServers[0]).toMatchObject({ name: 'linter', enabled: false, command: 'linter-server' })
    expect(result[0].status).toBe('installed')
  })

  it('缺必填配置时状态是 config_required', () => {
    const { deps } = makeDeps()
    const payload: InstallPayload = { kind: 'mcp', name: 'api', transport: 'streamable_http', url: 'https://x', timeoutMs: 10_000 }
    const result = installPayloads([payload], { ...context, configFields: [{ key: 'TOKEN', label: 'Token', target: 'env', required: true, secret: true }] }, deps)
    expect(result[0].status).toBe('config_required')
  })

  it('填了配置后按 target 分发到 env', () => {
    const { deps, savedServers } = makeDeps()
    const payload: InstallPayload = { kind: 'mcp', name: 'api', transport: 'streamable_http', url: 'https://x', timeoutMs: 10_000 }
    installPayloads([payload], {
      ...context,
      configFields: [{ key: 'TOKEN', label: 'Token', target: 'env', required: true, secret: true }],
      config: { TOKEN: 'abcd' }
    }, deps)
    expect(savedServers[0].env).toEqual({ TOKEN: 'abcd' })
  })

  it('一条目录项的多个载荷各自落地', () => {
    const { deps } = makeDeps()
    const result = installPayloads([
      skillPayload('alpha'),
      { kind: 'mcp', name: 'linter', transport: 'stdio', command: 'x', timeoutMs: 10_000 }
    ], context, deps)
    expect(result.map((item) => item.abilityType)).toEqual(['skill', 'mcp'])
  })

  it('CLI 载荷明确拒绝而不是静默跳过', () => {
    const { deps } = makeDeps()
    const payload: InstallPayload = { kind: 'cli', name: 'gh', executable: 'gh', versionArgs: ['--version'], allowPatterns: ['gh *'] }
    expect(() => installPayloads([payload], context, deps)).toThrow('CLI 能力暂不支持从 Hub 安装')
  })
})
