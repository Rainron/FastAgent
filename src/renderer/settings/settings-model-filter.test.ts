import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../shared/types'
import { filterSettingsModels } from './settings-model-filter'

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
})
