import { describe, expect, it } from 'vitest'
import { applyOverride, applyOverrides, isEmptyOverride, normalizeOverride, overrideKey } from './model-parameters'
import { resolveContextWindow } from './model-context-windows'

describe('模型参数覆盖', () => {
  it('键由 provider 与模型名组成，不依赖后端 id', () => {
    expect(overrideKey('OpenAI', 'gpt-4o')).toBe('OpenAI\tgpt-4o')
  })

  it('裁剪掉不认识的键与 undefined', () => {
    expect(normalizeOverride({ context_window: 200_000, nonsense: 1, max_tokens: undefined })).toEqual({ context_window: 200_000 })
    expect(normalizeOverride(null)).toEqual({})
    expect(normalizeOverride(['x'])).toEqual({})
  })

  it('只覆盖出现过的键，其余原样保留', () => {
    const model = { id: 1, provider: 'OpenAI', model_name: 'gpt-4o', context_window: 128_000, max_tokens: 8_192 }
    expect(applyOverride(model, { context_window: 200_000 })).toEqual({ ...model, context_window: 200_000 })
  })

  it('覆盖里显式写 null 的 JSON 字段会生效，缺键则不动', () => {
    const model = { provider: 'OpenAI', model_name: 'gpt-4o', extra_body: { top_p: 0.8 } as Record<string, unknown> | null, compat: null }
    expect(applyOverride(model, { extra_body: null }).extra_body).toBeNull()
    expect(applyOverride(model, {}).extra_body).toEqual({ top_p: 0.8 })
  })

  it('空覆盖与无覆盖都原样返回同一个对象', () => {
    const model = { provider: 'OpenAI', model_name: 'gpt-4o' }
    expect(applyOverride(model, undefined)).toBe(model)
    expect(applyOverride(model, {})).toBe(model)
  })

  it('isEmptyOverride 区分「没设过」与「设过」', () => {
    expect(isEmptyOverride({})).toBe(true)
    expect(isEmptyOverride({ max_tokens: undefined })).toBe(true)
    expect(isEmptyOverride({ compat: null })).toBe(false)
  })

  it('批量套用只命中同 provider 同名的模型', () => {
    const models = [
      { provider: 'OpenAI', model_name: 'gpt-4o', context_window: 128_000 },
      { provider: 'Anthropic', model_name: 'gpt-4o', context_window: 128_000 }
    ]
    const overrides = new Map([[overrideKey('OpenAI', 'gpt-4o'), { context_window: 400_000 }]])
    expect(applyOverrides(models, overrides).map((model) => model.context_window)).toEqual([400_000, 128_000])
  })

  it('优先级链：覆盖 > 云端下发 > 名字推断 > 默认', () => {
    const cloud = { provider: 'Anthropic', model_name: 'claude-opus-4-5', context_window: 100_000 }
    // 覆盖赢过云端下发
    expect(resolveContextWindow(applyOverride(cloud, { context_window: 500_000 }).context_window, cloud.model_name)).toBe(500_000)
    // 无覆盖时用云端下发
    expect(resolveContextWindow(applyOverride(cloud, undefined).context_window, cloud.model_name)).toBe(100_000)
    // 云端也没给时回落到名字推断
    expect(resolveContextWindow(applyOverride({ ...cloud, context_window: null }, undefined).context_window, cloud.model_name)).toBe(200_000)
    // 推断也不中才是默认值
    expect(resolveContextWindow(null, 'my-private-model')).toBe(128_000)
  })
})
