import { describe, expect, it } from 'vitest'
import { normalizeFlagEmoji } from './flag-emoji'

describe('normalizeFlagEmoji', () => {
  it('成对区域指示符转国家代码字母', () => {
    expect(normalizeFlagEmoji('西班牙 🇪🇸 夺冠')).toBe('西班牙 ES 夺冠')
    expect(normalizeFlagEmoji('🇯🇵🇰🇷')).toBe('JPKR')
  })

  it('孤立区域指示符转单个字母', () => {
    // 代理对中间被损坏后常见的残留：U+FFFD + 孤立的区域指示符
    expect(normalizeFlagEmoji('\uFFFD\uD83C\uDDF8')).toBe('S')
  })

  it('剔除替换符 U+FFFD', () => {
    expect(normalizeFlagEmoji('前\uFFFD后')).toBe('前后')
    expect(normalizeFlagEmoji('\uFFFD\uFFFD')).toBe('')
  })

  it('普通文本与其他 emoji 原样保留', () => {
    expect(normalizeFlagEmoji('冠军 🏆 🎉 ok')).toBe('冠军 🏆 🎉 ok')
    expect(normalizeFlagEmoji('')).toBe('')
  })

  it('普通字符紧邻区域指示符时不受影响', () => {
    expect(normalizeFlagEmoji('a\uD83C\uDDF8b')).toBe('aSb')
  })
})
