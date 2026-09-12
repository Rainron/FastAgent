import { describe, expect, it } from 'vitest'
import type { Ability, HubQuery } from '../../shared/types'
import { decorateListings, searchProviders } from './aggregator'
import type { HubListingDraft, RegistryProvider } from './types'

function draft(name: string, overrides: Partial<HubListingDraft> = {}): HubListingDraft {
  return {
    ref: name,
    name,
    displayName: name,
    description: `${name} 描述`,
    abilityType: 'skill',
    version: '1.0.0',
    categories: [],
    tags: [],
    permissions: { runsLocalCode: false, networkAccess: false, fileAccess: false },
    configFields: [],
    ...overrides
  }
}

function provider(id: string, drafts: HubListingDraft[] | Error, delayMs = 0): RegistryProvider {
  return {
    id,
    kind: 'git',
    name: `源 ${id}`,
    async search(_query: HubQuery) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (drafts instanceof Error) throw drafts
      return drafts
    },
    async detail() { throw new Error('unused') },
    async fetchPayload() { throw new Error('unused') }
  }
}

describe('searchProviders', () => {
  const signal = new AbortController().signal

  it('合并多源结果并标注来源', async () => {
    const result = await searchProviders([provider('a', [draft('alpha')]), provider('b', [draft('beta')])], {}, signal)
    expect(result.failures).toEqual([])
    expect(result.items.map((item) => [item.sourceId, item.id])).toEqual([
      ['a', 'a::alpha'],
      ['b', 'b::beta']
    ])
  })

  it('同名条目按源顺序去重，前面的源赢', async () => {
    const result = await searchProviders([provider('a', [draft('shared')]), provider('b', [draft('shared')])], {}, signal)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].sourceId).toBe('a')
  })

  it('同名但类型不同的条目都保留', async () => {
    const result = await searchProviders([provider('a', [draft('x'), draft('x', { ref: 'x-mcp', abilityType: 'mcp' })])], {}, signal)
    expect(result.items).toHaveLength(2)
  })

  it('单源失败不影响其它源，并记进 failures', async () => {
    const result = await searchProviders([provider('bad', new Error('仓库 404')), provider('ok', [draft('alpha')])], {}, signal)
    expect(result.items.map((item) => item.name)).toEqual(['alpha'])
    expect(result.failures).toEqual([{ sourceId: 'bad', message: '仓库 404' }])
  })

  it('单源超时不拖垮整体', async () => {
    const result = await searchProviders([provider('slow', [draft('slow')], 50), provider('fast', [draft('fast')])], {}, signal, { timeoutMs: 10 })
    expect(result.items.map((item) => item.name)).toEqual(['fast'])
    expect(result.failures.map((item) => item.sourceId)).toEqual(['slow'])
  })

  it('limit 在合并后统一截断', async () => {
    const result = await searchProviders([provider('a', [draft('a1'), draft('a2')]), provider('b', [draft('b1')])], { limit: 2, sort: 'name' }, signal)
    expect(result.items.map((item) => item.name)).toEqual(['a1', 'a2'])
  })
})

describe('decorateListings', () => {
  const listing = { ...draft('alpha'), sourceId: 'team', id: 'team::alpha' }

  function ability(overrides: Partial<Ability> = {}): Ability {
    return {
      id: 'alpha', name: 'alpha', displayName: 'Alpha', type: 'skill', source: 'marketplace',
      enabled: true, status: 'ready', version: '1.0.0', ...overrides
    }
  }

  it('未安装时安装态为 false', () => {
    expect(decorateListings([listing], [])[0]).toMatchObject({ installed: false, updateAvailable: false, abilityId: undefined })
  })

  it('按 pluginId 对齐已安装能力', () => {
    const [result] = decorateListings([listing], [ability({ pluginId: 'team::alpha' })])
    expect(result).toMatchObject({ installed: true, installedVersion: '1.0.0', abilityId: 'alpha' })
  })

  it('目录版本更高时标出可更新', () => {
    const [result] = decorateListings([{ ...listing, version: '2.0.0' }], [ability({ pluginId: 'team::alpha' })])
    expect(result.updateAvailable).toBe(true)
  })

  it('没有 pluginId 时按类型 + 名称兜底对齐', () => {
    const [result] = decorateListings([listing], [ability({ source: 'imported' })])
    expect(result.installed).toBe(true)
  })

  it('同名但类型不同不算已安装', () => {
    const [result] = decorateListings([listing], [ability({ type: 'mcp' })])
    expect(result.installed).toBe(false)
  })
})
