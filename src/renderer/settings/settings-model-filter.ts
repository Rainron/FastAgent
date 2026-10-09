import type { ModelOption } from '../../shared/types'
import { filterModelOptions, groupModelsByChannel } from '../model-picker'

export function filterSettingsModels(models: ModelOption[], query: string, filter: 'all' | 'cloud' | 'local' | 'favorite', favorites: number[]) {
  return filterModelOptions(models, query).filter((model) => {
    if (filter === 'favorite') return favorites.includes(model.id)
    if (filter === 'cloud') return model.source !== 'local'
    if (filter === 'local') return model.source === 'local'
    return true
  })
}

/** 设置页始终按用户可见的厂商分组，组内顺序沿用接口返回顺序。 */
export function groupSettingsModels(models: ModelOption[], query: string, filter: 'all' | 'cloud' | 'local' | 'favorite', favorites: number[]) {
  return groupModelsByChannel(filterSettingsModels(models, query, filter, favorites))
}
