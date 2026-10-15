import { describe, expect, it } from 'vitest'
import { addModel, connectionDraft, mergeModels, selectConnectionId } from './form-state'

describe('model connection form', () => {
  it('leaves an existing credential untouched when the key is blank', () => {
    expect(connectionDraft({ providerId: 'openai', authMode: 'api-key', apiKey: '   ', name: ' 工作 ', baseUrl: ' https://api.openai.com/v1 ' })).toEqual({ providerId: 'openai', authMode: 'api-key', name: '工作', baseUrl: 'https://api.openai.com/v1' })
  })
  it('adds trimmed model ids without duplicates', () => {
    expect(addModel([{ modelId: 'a', name: 'A' }], ' a ')).toEqual([{ modelId: 'a', name: 'A' }])
    expect(addModel([], ' b ')).toEqual([{ modelId: 'b', name: 'b' }])
    expect(addModel([], ' ')).toEqual([])
  })
  it('批量加入时跳过已在连接里的模型，保留其已有参数', () => {
    const existing: Array<{ modelId: string; name: string; contextWindow?: number }> = [{ modelId: 'a', name: 'A', contextWindow: 4096 }]
    expect(mergeModels(existing, [{ modelId: 'a', name: '发现的 A' }, { modelId: ' b ', name: 'B' }]))
      .toEqual([{ modelId: 'a', name: 'A', contextWindow: 4096 }, { modelId: 'b', name: 'B' }])
  })
  it('批量加入时同一批里的重复项只进一次，没有新增则返回原数组', () => {
    const existing = [{ modelId: 'a' }]
    expect(mergeModels(existing, [{ modelId: 'a' }, { modelId: ' ' }])).toBe(existing)
    expect(mergeModels([], [{ modelId: 'c' }, { modelId: 'c' }])).toEqual([{ modelId: 'c' }])
  })
  it('从模型清单进入时定位对应连接，并兼容没有连接 id 的旧模型', () => {
    const connections = [
      { id: 'first', models: [{ model_name: 'model-a' }] },
      { id: 'second', models: [{ model_name: 'model-b' }] }
    ]
    expect(selectConnectionId(connections, null, { connectionId: 'second', modelId: 'model-b' })).toBe('second')
    expect(selectConnectionId(connections, null, { modelId: 'model-b' })).toBe('second')
    expect(selectConnectionId(connections, 'first', { connectionId: 'second', modelId: 'model-b' })).toBe('first')
    expect(selectConnectionId(connections, null, { connectionId: 'missing', modelId: 'missing' })).toBe('first')
    expect(selectConnectionId([], null, { modelId: 'model-b' })).toBeNull()
  })
})
