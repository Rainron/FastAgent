import { describe, expect, it } from 'vitest'
import type { LocalModelSummary } from '../shared/types'
import { listLocalModelCatalog } from './model-catalog'
import { mergeModelOptions, modelSections } from '../renderer/model-picker'

describe('模型目录连接归属', () => {
  it('用连接元数据替换原始行，连接改名和同名连接均保持正确分组', () => {
    const raw = [{ id: -1, connectionId: 'a', name: '模型 A' }, { id: -2, connectionId: 'b', name: '模型 B' }, { id: -3, name: '旧模型', provider: '旧服务' }] as LocalModelSummary[]
    const connections = raw.slice(0, 2).map((model) => ({ ...model, connectionName: '同名服务', provider: 'OpenAI', model_name: model.name }))
    const local = listLocalModelCatalog({ listLocalModels: () => raw, modelConnections: () => ({ listModels: () => connections }) })
    expect(local.map((model) => model.id)).toEqual([-1, -2, -3])
    const sections = modelSections(mergeModelOptions([], local))
    expect(sections[0].groups.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'connection:a', label: '同名服务' }, { id: 'connection:b', label: '同名服务' }, { id: 'connection:旧模型', label: '旧模型' }
    ])
  })
})
