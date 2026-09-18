import { describe, expect, it } from 'vitest'
import { getSupportedThinkingLevels, normalizeThinkingLevel, resolveThinkingLevel } from './thinking-level'

describe('思考档位解析', () => {
  const model = { supports_thinking: true }
  it('标准能力包含关闭与 minimal，不猜测高级档位', () => {
    expect(getSupportedThinkingLevels(model)).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    expect(getSupportedThinkingLevels({ supports_thinking: false })).toEqual(['off'])
  })
  it('默认跟随模型配置，未配置或配置非法时关闭', () => {
    expect(resolveThinkingLevel('auto', model)).toBe('off')
    expect(resolveThinkingLevel('auto', { ...model, thinking_default: 'medium' })).toBe('medium')
    expect(resolveThinkingLevel('auto', { ...model, thinking_default: 'garbage' })).toBe('off')
    expect(resolveThinkingLevel('off', { ...model, thinking_default: 'medium' })).toBe('off')
  })
  it('恢复历史和模型切换只接受当前模型能力，ultra 降为最高支持档', () => {
    const advanced = { ...model, thinking_level_map: { xhigh: 'xhigh', max: 'max' } }
    expect(normalizeThinkingLevel('ULTRA', advanced)).toBe('max')
    expect(normalizeThinkingLevel('ultra', model)).toBe('high')
    expect(normalizeThinkingLevel('max', model)).toBe('auto')
    expect(normalizeThinkingLevel('invalid', model)).toBe('auto')
    expect(normalizeThinkingLevel('off', model)).toBe('off')
    expect(resolveThinkingLevel('high', { supports_thinking: false })).toBe('off')
  })
  it('显式 null 能力不能被 profiles 或 default 重新启用', () => {
    const restricted = { ...model, thinking_level_map: { minimal: null, high: null }, thinking_profiles: { low: {}, high: {}, ultra: {} }, thinking_default: 'high' }
    expect(getSupportedThinkingLevels(restricted)).toEqual(['off', 'low'])
    expect(resolveThinkingLevel('auto', restricted)).toBe('off')
  })
  it('强制思考模型未配置默认值时选择首个合法档位', () => {
    const forced = { ...model, thinking_level_map: { off: null, minimal: null, low: null } }
    expect(getSupportedThinkingLevels(forced)).toEqual(['medium', 'high'])
    expect(resolveThinkingLevel('auto', forced)).toBe('medium')
    expect(resolveThinkingLevel('off', forced)).toBe('medium')
  })
})
