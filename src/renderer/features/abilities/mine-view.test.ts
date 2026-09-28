import { describe, expect, it } from 'vitest'
import {
  ABILITIES_TAB_STORAGE_KEY,
  displayableAbilities,
  filterMineRows,
  matchesMineStatus,
  mineRowsForType,
  mineStats,
  readStoredAbilitiesTab,
  resolveInitialAbilitiesTab,
  sortMineRows,
  writeStoredAbilitiesTab
} from './mine-view'
import type { Ability, CliAbility, McpAbility, SkillAbility } from '../../../shared/types'

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

function cli(patch: Partial<CliAbility> & Pick<CliAbility, 'id'>): CliAbility {
  return {
    name: patch.id,
    displayName: patch.id,
    type: 'cli',
    source: 'builtin',
    enabled: true,
    status: 'ready',
    executable: 'git',
    versionArgs: ['--version'],
    allowPatterns: ['git:*'],
    check: null,
    ...patch
  }
}

/** node 环境没有 sessionStorage，用同接口的内存实现验证读写契约。 */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial))
  return {
    get length() { return store.size },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => void store.delete(key),
    setItem: (key, value) => void store.set(key, value)
  } as Storage
}

describe('Tab 初始化与持久化', () => {
  it('记住的 Tab 优先于默认落点', () => {
    expect(resolveInitialAbilitiesTab('discover', [skill({ id: 'a' })])).toBe('discover')
    expect(resolveInitialAbilitiesTab('mine', [])).toBe('mine')
  })

  it('未加载完不动；加载后按「有已安装能力」决定首进落点', () => {
    expect(resolveInitialAbilitiesTab(null, null)).toBeNull()
    expect(resolveInitialAbilitiesTab(null, [skill({ id: 'a' })])).toBe('mine')
    expect(resolveInitialAbilitiesTab(null, [])).toBe('discover')
  })

  it('sessionStorage 读写往返，非法值当作没有记忆', () => {
    const storage = memoryStorage()
    writeStoredAbilitiesTab('mine', storage)
    expect(readStoredAbilitiesTab(storage)).toBe('mine')
    writeStoredAbilitiesTab('discover', storage)
    expect(readStoredAbilitiesTab(storage)).toBe('discover')

    const dirty = memoryStorage({ [ABILITIES_TAB_STORAGE_KEY]: 'overview' })
    expect(readStoredAbilitiesTab(dirty)).toBeNull()
  })

  it('存储不可用时读写都不抛错', () => {
    expect(readStoredAbilitiesTab(null)).toBeNull()
    expect(() => writeStoredAbilitiesTab('mine', null)).not.toThrow()
  })
})

describe('展示与统计口径', () => {
  it('「我的能力」只展示 Skill 与 MCP，CLI 被排除且 Skill 在前', () => {
    const rows = displayableAbilities([skill({ id: 's' }), cli({ id: 'c' }), mcp({ id: 'm' })])
    expect(rows.map((row) => row.id)).toEqual(['s', 'm'])
  })

  it('统计基于可展示能力：已安装总数等于 Skills 数加 MCP 数，CLI 不计数', () => {
    const stats = mineStats([
      skill({ id: 's1' }),
      skill({ id: 's2', enabled: false }),
      mcp({ id: 'm1', status: 'config_required' }),
      mcp({ id: 'm2', status: 'update_available' }),
      cli({ id: 'c1', enabled: false, status: 'error' })
    ])
    expect(stats.total).toBe(4)
    expect(stats.skills).toBe(2)
    expect(stats.mcp).toBe(2)
    expect(stats.enabled).toBe(3)
    expect(stats.attention).toBe(1)
    expect(stats.updates).toBe(1)
  })

  it('全局统计取全量，分页切片不参与统计口径', () => {
    // 25 条能力、页长 20：翻页只改变可见行，统计行必须仍按 25 条算
    const abilities: Ability[] = Array.from({ length: 25 }, (_, index) => skill({ id: `s${index}` }))
    const visible = abilities.slice(0, 20)
    expect(visible).toHaveLength(20)
    expect(mineStats(abilities).total).toBe(25)
  })
})

describe('类型 chips 与状态筛选', () => {
  const rows = [
    skill({ id: 's-ok' }),
    skill({ id: 's-attention', status: 'config_required' }),
    mcp({ id: 'm-off', enabled: false }),
    mcp({ id: 'm-update', status: 'update_available' }),
    mcp({ id: 'm-conn', connection: { state: 'error', error: 'boom', toolCount: 0, resourceCount: 0, promptCount: 0, tools: [] } })
  ]

  it('类型 chips 切换参与分页的行集合', () => {
    expect(mineRowsForType(rows, 'all').map((row) => row.id)).toEqual(['s-ok', 's-attention', 'm-off', 'm-update', 'm-conn'])
    expect(mineRowsForType(rows, 'skill').map((row) => row.id)).toEqual(['s-ok', 's-attention'])
    expect(mineRowsForType(rows, 'mcp').map((row) => row.id)).toEqual(['m-off', 'm-update', 'm-conn'])
    expect(mineRowsForType(rows, 'attention').map((row) => row.id)).toEqual(['s-attention'])
  })

  it('统一状态筛选覆盖启用、停用、待处理、更新与连接异常', () => {
    expect(rows.filter((row) => matchesMineStatus(row, 'enabled')).map((row) => row.id)).toEqual(['s-ok', 's-attention', 'm-update', 'm-conn'])
    expect(rows.filter((row) => matchesMineStatus(row, 'disabled')).map((row) => row.id)).toEqual(['m-off'])
    expect(rows.filter((row) => matchesMineStatus(row, 'attention')).map((row) => row.id)).toEqual(['s-attention'])
    expect(rows.filter((row) => matchesMineStatus(row, 'update_available')).map((row) => row.id)).toEqual(['m-update'])
    // 连接异常只对 MCP 有意义，Skill 一律不匹配
    expect(rows.filter((row) => matchesMineStatus(row, 'connection_error')).map((row) => row.id)).toEqual(['m-conn'])
  })

  it('统一搜索匹配名称、描述与 MCP 命令/地址', () => {
    const target = [
      skill({ id: 'csv-helper', description: '处理表格数据' }),
      mcp({ id: 'remote-x', command: 'npx', url: 'https://example.dev/feed' })
    ]
    expect(filterMineRows(target, { keyword: '表格' }).map((row) => row.id)).toEqual(['csv-helper'])
    expect(filterMineRows(target, { keyword: 'example.dev' }).map((row) => row.id)).toEqual(['remote-x'])
    expect(filterMineRows(target, { keyword: 'npx' }).map((row) => row.id)).toEqual(['remote-x'])
    expect(filterMineRows(target, { keyword: '不存在' })).toEqual([])
  })

  it('状态与关键词叠加时取交集', () => {
    const target = [
      skill({ id: 'alpha-on' }),
      skill({ id: 'alpha-off', enabled: false }),
      skill({ id: 'beta-on' })
    ]
    expect(filterMineRows(target, { keyword: 'alpha', status: 'disabled' }).map((row) => row.id)).toEqual(['alpha-off'])
  })

  it('排序复用能力页统一规则：名称、状态与安装时间', () => {
    const target = [
      mcp({ id: 'zeta', installedAt: '2026-01-05T00:00:00.000Z' }),
      skill({ id: 'alpha', installedAt: '2026-01-03T00:00:00.000Z' }),
      skill({ id: 'mid', status: 'error', installedAt: '2026-01-04T00:00:00.000Z' })
    ]
    expect(sortMineRows(target, 'name').map((row) => row.id)).toEqual(['alpha', 'mid', 'zeta'])
    expect(sortMineRows(target, 'recent').map((row) => row.id)).toEqual(['zeta', 'mid', 'alpha'])
    expect(sortMineRows(target, 'status').map((row) => row.id)[0]).toBe('mid')
  })
})
