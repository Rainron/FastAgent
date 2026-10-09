import { describe, expect, it } from 'vitest'
import { CONTEXT_WINDOW_PRESETS, CUSTOM_PRESET, TEMPERATURE_PRESETS, presetSelection, presetValue } from './model-parameter-presets'

describe('presetSelection', () => {
  it('空值选中「跟随默认」', () => {
    expect(presetSelection('', CONTEXT_WINDOW_PRESETS)).toBe('')
    expect(presetSelection('   ', CONTEXT_WINDOW_PRESETS)).toBe('')
  })

  it('命中挡位时选中该挡位', () => {
    expect(presetSelection('131072', CONTEXT_WINDOW_PRESETS)).toBe('131072')
    expect(presetSelection('1048576', CONTEXT_WINDOW_PRESETS)).toBe('1048576')
    expect(presetSelection('0.7', TEMPERATURE_PRESETS)).toBe('0.7')
  })

  it('挡位外的值落到自定义，等值不等形的写法也算自定义', () => {
    expect(presetSelection('123456', CONTEXT_WINDOW_PRESETS)).toBe(CUSTOM_PRESET)
    expect(presetSelection('131072.0', CONTEXT_WINDOW_PRESETS)).toBe(CUSTOM_PRESET)
  })
})

describe('presetValue', () => {
  it('选挡位写挡位值', () => {
    expect(presetValue('262144', '131072')).toBe('262144')
  })

  it('选「跟随默认」清空', () => {
    expect(presetValue('', '131072')).toBe('')
  })

  it('选「自定义」保留已输入的值，不把用户敲的清掉', () => {
    expect(presetValue(CUSTOM_PRESET, '131072')).toBe('131072')
    expect(presetValue(CUSTOM_PRESET, '')).toBe('')
  })
})

describe('挡位清单', () => {
  it('上下文挡位覆盖主流规格且全是正整数', () => {
    const labels = CONTEXT_WINDOW_PRESETS.map((preset) => preset.label)
    expect(labels).toContain('128K')
    expect(labels).toContain('256K')
    expect(labels).toContain('1M')
    for (const preset of CONTEXT_WINDOW_PRESETS) {
      expect(Number.isInteger(Number(preset.value))).toBe(true)
      expect(Number(preset.value)).toBeGreaterThan(0)
    }
  })

  it('挡位值不重复，下拉里不会出现两个同值项', () => {
    const values = CONTEXT_WINDOW_PRESETS.map((preset) => preset.value)
    expect(new Set(values).size).toBe(values.length)
  })
})
