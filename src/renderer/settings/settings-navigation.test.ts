import { describe, expect, it } from 'vitest'
import { settingsCategories, settingsNavigation } from './settings-navigation'

describe('settings navigation', () => {
  it('keeps the five reference pages in order', () => {
    expect(settingsNavigation('permissions').primary.map((item) => item.key)).toEqual(['permissions', 'models', 'memory', 'knowledge', 'prompts'])
  })
  it('keeps every existing category reachable, including deep links', () => {
    // 公开版没有 Computer Use，分类比私有少一个（私有是 16）
    expect(new Set(settingsCategories.map((item) => item.key)).size).toBe(15)
    for (const category of settingsCategories) {
      const result = settingsNavigation(category.key)
      expect(result.active.key).toBe(category.key)
      expect([...result.primary, ...result.tabs].some((item) => item.key === category.key)).toBe(true)
      expect(result.tabs.every((item) => item.group === category.group)).toBe(true)
    }
  })
})
