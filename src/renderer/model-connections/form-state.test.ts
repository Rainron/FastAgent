import { describe, expect, it } from 'vitest'
import { addModel, connectionDraft, visibleLegacyModels } from './form-state'

describe('model connection form', () => {
  it('leaves an existing credential untouched when the key is blank', () => {
    expect(connectionDraft({ providerId: 'openai', authMode: 'api-key', apiKey: '   ', name: ' 工作 ', baseUrl: ' https://api.openai.com/v1 ' })).toEqual({ providerId: 'openai', authMode: 'api-key', name: '工作', baseUrl: 'https://api.openai.com/v1' })
  })
  it('adds trimmed model ids without duplicates', () => {
    expect(addModel([{ modelId: 'a', name: 'A' }], ' a ')).toEqual([{ modelId: 'a', name: 'A' }])
    expect(addModel([], ' b ')).toEqual([{ modelId: 'b', name: 'b' }])
    expect(addModel([], ' ')).toEqual([])
  })
  it('does not show connection models in the legacy list', () => {
    expect(visibleLegacyModels([{ id: -1 }, { id: -2 }], [{ models: [{ id: -1 }] }])).toEqual([{ id: -2 }])
  })
})
