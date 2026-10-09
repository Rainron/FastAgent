import { describe, expect, it } from 'vitest'
import { clampKbRecall, normalizeKnowledgeSettings } from './knowledge-settings'

describe('知识库检索设置', () => {
  it('旧配置缺整块时补默认值，保持引入设置前的行为', () => {
    expect(normalizeKnowledgeSettings(undefined)).toEqual({ enabled: true, maxRecall: 3 })
    expect(normalizeKnowledgeSettings({ enabled: false })).toEqual({ enabled: false, maxRecall: 3 })
  })

  it('注入条数夹在 1~8，非法值回默认', () => {
    expect(clampKbRecall(0)).toBe(1)
    expect(clampKbRecall(20)).toBe(8)
    expect(clampKbRecall(4.6)).toBe(5)
    expect(clampKbRecall('5')).toBe(3)
    expect(clampKbRecall(Number.NaN)).toBe(3)
  })
})
