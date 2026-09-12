import { describe, expect, it } from 'vitest'
import { BuiltinCatalogProvider, listCategories, searchPlugins, type PluginCatalogEntry } from './catalog'
import { builtinCatalog } from './catalog-data'

function entry(patch: Partial<PluginCatalogEntry> & Pick<PluginCatalogEntry, 'id' | 'name'>): PluginCatalogEntry {
  return {
    displayName: patch.name,
    description: '',
    abilityType: 'skill',
    version: '1.0.0',
    categories: [],
    tags: [],
    publishedAt: '2026-01-01T00:00:00.000Z',
    permissions: { runsLocalCode: false, networkAccess: false, fileAccess: false },
    configFields: [],
    payload: { kind: 'skill', files: { 'SKILL.md': '' } },
    ...patch
  } as PluginCatalogEntry
}

const entries: PluginCatalogEntry[] = [
  entry({ id: 'a', name: 'alpha', displayName: 'Alpha', description: '处理表格', categories: ['数据'], tags: ['csv'], featured: true, downloadCount: 10, trending: 5, publishedAt: '2026-01-01T00:00:00.000Z' }),
  entry({ id: 'b', name: 'bravo', displayName: 'Bravo', abilityType: 'mcp', categories: ['开发'], tags: ['git'], downloadCount: 99, trending: 90, publishedAt: '2026-05-01T00:00:00.000Z', payload: { kind: 'mcp', transport: 'stdio', command: 'npx', timeoutMs: 1000 } }),
  entry({ id: 'c', name: 'charlie', displayName: 'Charlie', categories: ['数据', '开发'], tags: ['sql'], downloadCount: 50, trending: 20, publishedAt: '2026-03-01T00:00:00.000Z' })
]

describe('plugin catalog', () => {
  it('关键词覆盖名称、简介、标签与分类', () => {
    expect(searchPlugins(entries, { keyword: '表格' }).map((item) => item.id)).toEqual(['a'])
    expect(searchPlugins(entries, { keyword: 'SQL' }).map((item) => item.id)).toEqual(['c'])
    expect(searchPlugins(entries, { keyword: '开发' }).map((item) => item.id).sort()).toEqual(['b', 'c'])
  })

  it('按能力类型与分类筛选', () => {
    expect(searchPlugins(entries, { abilityType: 'mcp' }).map((item) => item.id)).toEqual(['b'])
    expect(searchPlugins(entries, { category: '数据' }).map((item) => item.id)).toEqual(['a', 'c'])
    expect(searchPlugins(entries, { abilityType: 'skill', category: '开发' }).map((item) => item.id)).toEqual(['c'])
  })

  it('排序：默认推荐优先，其余按 trending / 时间 / 名称', () => {
    expect(searchPlugins(entries, {}).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(searchPlugins(entries, { sort: 'trending' }).map((item) => item.id)).toEqual(['b', 'c', 'a'])
    expect(searchPlugins(entries, { sort: 'latest' }).map((item) => item.id)).toEqual(['b', 'c', 'a'])
    expect(searchPlugins(entries, { sort: 'name' }).map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('分类去重并排序', () => {
    expect(listCategories(entries)).toEqual(['开发', '数据'])
  })

  it('内置 catalog 覆盖两类能力且 Skill 载荷含 SKILL.md', async () => {
    const listed = await new BuiltinCatalogProvider().list()
    expect(listed).toBe(builtinCatalog)
    expect(new Set(listed.map((item) => item.abilityType))).toEqual(new Set(['skill', 'mcp']))
    for (const item of listed) {
      expect(item.id).toBeTruthy()
      if (item.payload.kind === 'skill') expect(item.payload.files['SKILL.md']).toContain(`name: ${item.name}`)
      else expect(item.payload.transport === 'stdio' ? item.payload.command : item.payload.url).toBeTruthy()
    }
  })

  it('内置 MCP 条目的必填 secret 字段带 key 说明，不含默认值', () => {
    const github = builtinCatalog.find((item) => item.id === 'mcp.github')
    expect(github?.configFields.some((field) => field.secret && field.required && field.target === 'env')).toBe(true)
    expect(github?.permissions.envKeys).toContain('GITHUB_PERSONAL_ACCESS_TOKEN')
  })
})
