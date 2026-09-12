import { describe, expect, it } from 'vitest'
import { clampComposerHeight, MIN_COMPOSER_HEIGHT } from './composer-height'

describe('clampComposerHeight', () => {
  it('低于下限时抬到 MIN_COMPOSER_HEIGHT', () => {
    expect(clampComposerHeight(20, 1000)).toBe(MIN_COMPOSER_HEIGHT)
  })

  it('超过视口 60% 时按上限收窄', () => {
    expect(clampComposerHeight(900, 1000)).toBe(600)
  })

  it('区间内取四舍五入后的原值', () => {
    expect(clampComposerHeight(240.4, 1000)).toBe(240)
  })

  // 上限在 Math.min 的外层，视口矮到 60% 已低于下限时结果会跌破 MIN_COMPOSER_HEIGHT。
  it('视口矮于下限时上限优先，结果可低于 MIN_COMPOSER_HEIGHT', () => {
    expect(clampComposerHeight(300, 100)).toBe(60)
  })
})
