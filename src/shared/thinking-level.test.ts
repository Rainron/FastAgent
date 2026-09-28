import { describe, expect, it } from 'vitest'
import { defaultThinkingLevel, getSupportedThinkingLevels, nearestThinkingLevel, normalizeThinkingLevel, resolveThinkingLevel, selectableThinkingLevels } from './thinking-level'

describe('思考档位解析', () => {
  const model = { supports_thinking: true }
  it('标准能力包含关闭与 minimal，不猜测高级档位', () => {
    expect(getSupportedThinkingLevels(model)).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    expect(getSupportedThinkingLevels({ supports_thinking: false })).toEqual(['off'])
  })
  it('UI 可选档不含关闭；不支持思考的模型无可选档', () => {
    expect(selectableThinkingLevels(model)).toEqual(['minimal', 'low', 'medium', 'high'])
    expect(selectableThinkingLevels({ supports_thinking: false })).toEqual([])
    const withOff = { ...model, thinking_profiles: { off: {}, low: {}, medium: {} } }
    expect(selectableThinkingLevels(withOff)).toEqual(['low', 'medium'])
  })
  it('默认跟随模型配置，未配置或配置非法时就近选择最低思考档', () => {
    expect(resolveThinkingLevel('auto', model)).toBe('low')
    expect(resolveThinkingLevel('auto', { ...model, thinking_default: 'medium' })).toBe('medium')
    expect(resolveThinkingLevel('auto', { ...model, thinking_default: 'garbage' })).toBe('low')
    // off 已从 UI 移除：历史会话恢复出的 off 就近落位，不再关闭思考。
    expect(resolveThinkingLevel('off', { ...model, thinking_default: 'medium' })).toBe('low')
  })
  it('恢复历史和模型切换只接受当前模型能力，ultra 降为最高支持档', () => {
    const advanced = { ...model, thinking_level_map: { xhigh: 'xhigh', max: 'max' } }
    expect(normalizeThinkingLevel('ULTRA', advanced)).toBe('max')
    expect(normalizeThinkingLevel('ultra', model)).toBe('high')
    expect(normalizeThinkingLevel('max', model)).toBe('auto')
    expect(normalizeThinkingLevel('invalid', model)).toBe('auto')
    expect(normalizeThinkingLevel('off', model)).toBe('low')
    expect(resolveThinkingLevel('high', { supports_thinking: false })).toBe('off')
  })
  it('显式 null 能力不能被 profiles 或 default 重新启用，off 也不再无条件放行', () => {
    const restricted = { ...model, thinking_level_map: { minimal: null, high: null }, thinking_profiles: { low: {}, high: {}, ultra: {} }, thinking_default: 'high' }
    expect(getSupportedThinkingLevels(restricted)).toEqual(['low'])
    expect(resolveThinkingLevel('auto', restricted)).toBe('low')
  })
  it('平台 profiles 未声明 off 时不提供关闭思考，声明后才提供', () => {
    const noOff = { ...model, thinking_profiles: { low: {}, medium: {}, high: {} } }
    expect(getSupportedThinkingLevels(noOff)).toEqual(['low', 'medium', 'high'])
    const withOff = { ...model, thinking_profiles: { off: {}, low: {}, medium: {} } }
    expect(getSupportedThinkingLevels(withOff)).toEqual(['off', 'low', 'medium'])
  })
  it('就近落位：优先 low，缺失时依次 minimal、更高档；无可选档退回 off', () => {
    expect(nearestThinkingLevel(model)).toBe('low')
    expect(nearestThinkingLevel({ ...model, thinking_level_map: { low: null } })).toBe('minimal')
    expect(nearestThinkingLevel({ ...model, thinking_level_map: { minimal: null, low: null } })).toBe('medium')
    expect(nearestThinkingLevel({ supports_thinking: false })).toBe('off')
  })
  it('强制思考模型未配置默认值时选择就近最低档位', () => {
    const forced = { ...model, thinking_level_map: { off: null, minimal: null, low: null } }
    expect(getSupportedThinkingLevels(forced)).toEqual(['medium', 'high'])
    expect(resolveThinkingLevel('auto', forced)).toBe('medium')
    expect(resolveThinkingLevel('off', forced)).toBe('medium')
  })
  it('UI 默认档：平台默认与模型默认优先，缺失或为 off 时就近选择最低档', () => {
    expect(defaultThinkingLevel(undefined, model)).toBe('low')
    expect(defaultThinkingLevel('off', model)).toBe('low')
    expect(defaultThinkingLevel('medium', model)).toBe('medium')
    expect(defaultThinkingLevel('garbage', model)).toBe('low')
    expect(defaultThinkingLevel('low', { supports_thinking: false })).toBe('auto')
  })
})
