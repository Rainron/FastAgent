import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../shared/types'
import { filterSettingsModels, groupSettingsModels } from './settings-model-filter'

const models = [
  { id: 1, name: 'Cloud model', model_name: 'cloud', provider: 'Cloud' },
  { id: -1, name: 'Local model', model_name: 'local', provider: 'Local', source: 'local' }
] as ModelOption[]

describe('settings model filters', () => {
  it('combines the search with source and favorites, including local ids', () => {
    expect(filterSettingsModels(models, '', 'cloud', []).map((item) => item.id)).toEqual([1])
    expect(filterSettingsModels(models, '', 'local', []).map((item) => item.id)).toEqual([-1])
    expect(filterSettingsModels(models, 'local', 'favorite', [-1]).map((item) => item.id)).toEqual([-1])
    expect(filterSettingsModels(models, 'cloud', 'local', [])).toEqual([])
    expect(filterSettingsModels([], '', 'all', [])).toEqual([])
  })

  it('groups the filtered models by provider while preserving their order', () => {
    const grouped = groupSettingsModels([
      models[0],
      { id: 2, name: 'Cloud model 2', model_name: 'cloud-2', provider: 'Cloud' } as ModelOption,
      models[1]
    ], '', 'all', [])

    expect(grouped.map((group) => [group.channel, group.models.map((model) => model.id)])).toEqual([
      ['Cloud', [1, 2]],
      ['Local', [-1]]
    ])
  })
})
