import { describe, expect, it } from 'vitest'
import {
  abilitiesNeedingAttention,
  abilityStats,
  abilityStatusPresentation,
  canUninstall,
  connectionPresentation,
  filterAbilities,
  filterMcpAbilities,
  isMcp,
  isSkill,
  pendingPresentation,
  recentlyInstalledAbilities,
  recentlyUsedAbilities,
  SOURCE_LABELS,
  sortAbilities,
  transportLabel
} from './ability-view'
import type { Ability, McpAbility, SkillAbility } from '../../../shared/types'

function skill(patch: Partial<SkillAbility> & Pick<SkillAbility, 'id'>): SkillAbility {
  return {
    name: patch.id,
    displayName: patch.id,
    type: 'skill',
    source: 'created',
    enabled: true,
    status: 'ready',
    filePath: `/skills/${patch.id}/SKILL.md`,
    builtin: false,
    ...patch
  }
}

function mcp(patch: Partial<McpAbility> & Pick<McpAbility, 'id'>): McpAbility {
  return {
    name: patch.id,
    displayName: patch.id,
    type: 'mcp',
    source: 'imported',
    enabled: true,
    status: 'ready',
    transport: 'stdio',
    command: 'npx',
    timeoutMs: 30_000,
    hasSecrets: false,
    connection: { state: 'connected', error: null, toolCount: 2, resourceCount: 1, promptCount: 0, tools: [] },
    ...patch
  }
}

describe('状态与色调映射', () => {
  it('每个能力状态都有唯一文案与色调', () => {
    expect(abilityStatusPresentation('ready')).toEqual({ label: '正常可用', tone: 'ok' })
    expect(abilityStatusPresentation('disabled')).toEqual({ label: '已禁用', tone: 'muted' })
    expect(abilityStatusPresentation('config_required')).toEqual({ label: '需要配置', tone: 'warn' })
    expect(abilityStatusPresentation('update_available')).toEqual({ label: '有更新', tone: 'warn' })
    expect(abilityStatusPresentation('error')).toEqual({ label: '异常', tone: 'error' })
  })

  it('连接状态与进行中状态复用同一套色调 token', () => {
    expect(connectionPresentation('connected').tone).toBe('ok')
    expect(connectionPresentation('disconnected').tone).toBe('muted')
    expect(connectionPresentation('unknown').tone).toBe('muted')
    expect(connectionPresentation('error').tone).toBe('error')
    expect(pendingPresentation('installing')).toEqual({ label: '安装中', tone: 'accent' })
    expect(pendingPresentation('testing').tone).toBe('accent')
  })

  it('来源文案覆盖全部来源值', () => {
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual(['builtin', 'created', 'imported', 'marketplace'])
  })
})

describe('筛选与排序', () => {
  const abilities: Ability[] = [
    skill({ id: 'alpha', displayName: 'Alpha', description: '处理表格', status: 'error', source: 'marketplace' }),
    skill({ id: 'bravo', displayName: 'Bravo', enabled: false, status: 'disabled', installedAt: '2026-05-01T00:00:00.000Z' }),
    mcp({ id: 'charlie', displayName: 'Charlie', status: 'update_available', installedAt: '2026-07-01T00:00:00.000Z' })
  ]

  it('关键词匹配名称与描述', () => {
    expect(filterAbilities(abilities, { keyword: '表格' }).map((item) => item.id)).toEqual(['alpha'])
    expect(filterAbilities(abilities, { keyword: 'CHAR' }).map((item) => item.id)).toEqual(['charlie'])
  })

  it('状态筛选：异常包含需要配置，有更新单独一档', () => {
    expect(filterAbilities(abilities, { status: 'enabled' }).map((item) => item.id)).toEqual(['alpha', 'charlie'])
    expect(filterAbilities(abilities, { status: 'disabled' }).map((item) => item.id)).toEqual(['bravo'])
    expect(filterAbilities(abilities, { status: 'error' }).map((item) => item.id)).toEqual(['alpha'])
    expect(filterAbilities(abilities, { status: 'update_available' }).map((item) => item.id)).toEqual(['charlie'])
  })

  it('来源筛选', () => {
    expect(filterAbilities(abilities, { source: 'marketplace' }).map((item) => item.id)).toEqual(['alpha'])
    expect(filterAbilities(abilities, { source: 'all' })).toHaveLength(3)
  })

  it('按状态排序把待处理的排前面', () => {
    expect(sortAbilities(abilities, 'status').map((item) => item.id)).toEqual(['alpha', 'charlie', 'bravo'])
    expect(sortAbilities(abilities, 'name').map((item) => item.id)).toEqual(['alpha', 'bravo', 'charlie'])
    expect(sortAbilities(abilities, 'recent').map((item) => item.id)).toEqual(['charlie', 'bravo', 'alpha'])
  })
})

describe('MCP 视图', () => {
  const servers: McpAbility[] = [
    mcp({ id: 'ok' }),
    mcp({ id: 'broken', connection: { state: 'error', error: '连不上', toolCount: 0, resourceCount: 0, promptCount: 0, tools: [] }, status: 'error' }),
    mcp({ id: 'idle', connection: { state: 'unknown', error: null, toolCount: 0, resourceCount: 0, promptCount: 0, tools: [] } }),
    mcp({ id: 'off', enabled: false, status: 'disabled' }),
    mcp({ id: 'needs-config', status: 'config_required' })
  ]

  it('按连接状态筛选，异常档包含缺配置', () => {
    expect(filterMcpAbilities(servers, 'connected').map((item) => item.id)).toEqual(['ok', 'off', 'needs-config'])
    expect(filterMcpAbilities(servers, 'disconnected').map((item) => item.id)).toEqual(['idle'])
    expect(filterMcpAbilities(servers, 'error').map((item) => item.id)).toEqual(['broken', 'needs-config'])
    expect(filterMcpAbilities(servers, 'disabled').map((item) => item.id)).toEqual(['off'])
  })

  it('关键词也匹配命令与 URL', () => {
    const http = mcp({ id: 'remote', transport: 'streamable_http', command: undefined, url: 'https://mcp.example/mcp' })
    expect(filterMcpAbilities([http], 'all', 'mcp.example').map((item) => item.id)).toEqual(['remote'])
    expect(transportLabel(http)).toBe('HTTP · https://mcp.example/mcp')
    expect(transportLabel(mcp({ id: 'local' }))).toBe('stdio · npx')
  })
})

describe('统计与守卫', () => {
  it('概览统计区分类型、启用与连接结果', () => {
    const stats = abilityStats([
      skill({ id: 's1' }),
      skill({ id: 's2', enabled: false }),
      mcp({ id: 'm1' }),
      mcp({ id: 'm2', connection: { state: 'error', error: 'x', toolCount: 0, resourceCount: 0, promptCount: 0, tools: [] } })
    ])
    expect(stats).toEqual({ total: 4, skills: 2, mcp: 2, enabled: 3, attention: 0, updates: 0, connectionOk: 1, connectionFailed: 1 })
  })

  it('类型守卫与内置能力不可卸载', () => {
    expect(isSkill(skill({ id: 'a' }))).toBe(true)
    expect(isMcp(mcp({ id: 'b' }))).toBe(true)
    expect(canUninstall(skill({ id: 'c' }))).toBe(true)
    expect(canUninstall(skill({ id: 'd', source: 'builtin' }))).toBe(false)
  })
})

describe('概览页派生列表', () => {
  it('待办只收异常、缺配置与有更新，并按处理优先级排序', () => {
    const list = abilitiesNeedingAttention([
      skill({ id: 'ok' }),
      skill({ id: 'update', status: 'update_available' }),
      skill({ id: 'off', status: 'disabled', enabled: false }),
      mcp({ id: 'broken', status: 'error' }),
      mcp({ id: 'needs-config', status: 'config_required' })
    ])
    expect(list.map((item) => item.id)).toEqual(['broken', 'needs-config', 'update'])
  })

  it('最近安装按时间倒序并跳过没有安装时间的内置能力', () => {
    const list = recentlyInstalledAbilities([
      skill({ id: 'builtin', source: 'builtin' }),
      skill({ id: 'old', installedAt: '2026-01-01T00:00:00.000Z' }),
      mcp({ id: 'new', installedAt: '2026-08-01T00:00:00.000Z' })
    ])
    expect(list.map((item) => item.id)).toEqual(['new', 'old'])
  })

  it('最近使用按时间倒序，从没用过的不参与', () => {
    const list = recentlyUsedAbilities([
      skill({ id: 'never' }),
      skill({ id: 'yesterday', lastUsedAt: '2026-09-05T10:00:00.000Z' }),
      mcp({ id: 'today', lastUsedAt: '2026-09-06T09:00:00.000Z' })
    ])
    expect(list.map((item) => item.id)).toEqual(['today', 'yesterday'])
  })

  it('最近使用受 limit 约束', () => {
    const list = recentlyUsedAbilities(
      ['a', 'b', 'c'].map((id, index) => skill({ id, lastUsedAt: `2026-0${index + 1}-01T00:00:00.000Z` })),
      2
    )
    expect(list.map((item) => item.id)).toEqual(['c', 'b'])
  })

  it('最近安装受 limit 约束', () => {
    const list = recentlyInstalledAbilities(
      ['a', 'b', 'c'].map((id, index) => skill({ id, installedAt: `2026-0${index + 1}-01T00:00:00.000Z` })),
      2
    )
    expect(list.map((item) => item.id)).toEqual(['c', 'b'])
  })
})
