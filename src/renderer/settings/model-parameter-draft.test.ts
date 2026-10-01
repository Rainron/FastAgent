import { describe, expect, it } from 'vitest'
import {
  connectionPatchFromDraft, draftErrors, draftFromSource, EMPTY_PARAMETER_DRAFT,
  finiteNumber, nonNegativeInteger, overrideFromDraft, parseJsonField, positiveInteger
} from './model-parameter-draft'

const draft = (patch: Partial<typeof EMPTY_PARAMETER_DRAFT> = {}) => ({ ...EMPTY_PARAMETER_DRAFT, ...patch })

describe('数值字段解析', () => {
  it('正整数字段拒绝 0、负数与小数', () => {
    expect(positiveInteger('128000')).toBe(128_000)
    expect(positiveInteger('0')).toBeUndefined()
    expect(positiveInteger('-1')).toBeUndefined()
    expect(positiveInteger('1.5')).toBeUndefined()
    expect(positiveInteger('  ')).toBeUndefined()
  })

  it('重试次数允许 0', () => {
    expect(nonNegativeInteger('0')).toBe(0)
    expect(nonNegativeInteger('-1')).toBeUndefined()
  })

  it('温度允许小数与 0', () => {
    expect(finiteNumber('0')).toBe(0)
    expect(finiteNumber('0.7')).toBe(0.7)
    expect(finiteNumber('abc')).toBeUndefined()
  })
})

describe('JSON 字段解析', () => {
  it('空串是未设置而不是空对象', () => {
    expect(parseJsonField('  ')).toEqual({ ok: true, data: null })
  })

  it('数组与标量都不接受', () => {
    expect(parseJsonField('[1]').ok).toBe(false)
    expect(parseJsonField('"x"').ok).toBe(false)
    expect(parseJsonField('{').ok).toBe(false)
  })

  it('合法对象照收', () => {
    expect(parseJsonField('{"top_p": 0.8}')).toEqual({ ok: true, data: { top_p: 0.8 } })
  })
})

describe('草稿回填', () => {
  it('缺失字段留空串，供界面显示来源占位符', () => {
    expect(draftFromSource(null)).toEqual(EMPTY_PARAMETER_DRAFT)
    expect(draftFromSource({ context_window: null, max_tokens: undefined })).toEqual(EMPTY_PARAMETER_DRAFT)
  })

  it('布尔与 JSON 字段按三态回填', () => {
    expect(draftFromSource({ supports_thinking: false }).supportsThinking).toBe('no')
    expect(draftFromSource({ supports_thinking: true }).supportsThinking).toBe('yes')
    expect(draftFromSource({}).supportsThinking).toBe('')
    expect(draftFromSource({ extra_body: {} }).extraBody).toBe('')
    expect(draftFromSource({ extra_body: { top_p: 0.8 } }).extraBody).toContain('top_p')
  })

  it('重试次数 0 要回填成 "0" 而不是空串', () => {
    expect(draftFromSource({ max_retries: 0 }).maxRetries).toBe('0')
  })
})

describe('草稿校验', () => {
  it('全空是合法的', () => {
    expect(draftErrors(draft())).toEqual([])
  })

  it('逐项报错并带字段名', () => {
    const errors = draftErrors(draft({ contextWindow: '0', maxTokens: 'x', timeout: '-3', maxRetries: '1.5', temperature: 'hot', compat: '[' }))
    expect(errors).toHaveLength(6)
    expect(errors.some((item) => item.includes('上下文窗口'))).toBe(true)
    expect(errors.some((item) => item.includes('供应商兼容配置'))).toBe(true)
  })
})

describe('草稿转覆盖', () => {
  it('只登记填过的字段', () => {
    expect(overrideFromDraft(draft({ contextWindow: '200000' }))).toEqual({ context_window: 200_000 })
  })

  it('全空得到空覆盖，调用方据此删行', () => {
    expect(overrideFromDraft(draft())).toEqual({})
  })

  it('三态开关留空时不产生键', () => {
    expect(overrideFromDraft(draft({ supportsThinking: '' }))).toEqual({})
    expect(overrideFromDraft(draft({ supportsThinking: 'no' }))).toEqual({ supports_thinking: false })
    expect(overrideFromDraft(draft({ modelKind: 'multimodal' }))).toEqual({ model_kind: 'multimodal' })
  })

  it('有错时返回 null，拦住提交', () => {
    expect(overrideFromDraft(draft({ extraBody: '{' }))).toBeNull()
  })
})

describe('草稿转连接内模型补丁', () => {
  it('JSON 字段清空必须显式传 null，否则连接保存会按 ?? previous 保住旧值', () => {
    const patch = connectionPatchFromDraft(draft({ extraBody: '', compat: '' }))
    expect(patch).toMatchObject({ extraBody: null, compat: null })
  })

  it('多模态与 Reasoning 映射成连接侧的布尔字段', () => {
    expect(connectionPatchFromDraft(draft({ modelKind: 'multimodal', supportsThinking: 'no' })))
      .toMatchObject({ vision: true, reasoning: false })
  })

  it('三态留空时不下发布尔值', () => {
    const patch = connectionPatchFromDraft(draft())
    expect(patch?.vision).toBeUndefined()
    expect(patch?.reasoning).toBeUndefined()
  })
})
