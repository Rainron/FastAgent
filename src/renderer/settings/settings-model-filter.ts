import type { ModelOption } from '../../shared/types'
import { filterModelOptions } from '../model-picker'

export function filterSettingsModels(models: ModelOption[], query: string, filter: 'all' | 'cloud' | 'local' | 'favorite', favorites: number[]) {
  return filterModelOptions(models, query).filter((model) => {
    if (filter === 'favorite') return favorites.includes(model.id)
    if (filter === 'cloud') return model.source !== 'local'
    if (filter === 'local') return model.source === 'local'
    return true
  })
}
