import { describe, expect, it } from 'vitest'
import { createStreamTextRepair } from './stream-text-repair'

describe('createStreamTextRepair', () => {
  it('完整文本原样通过', () => {
    const repair = createStreamTextRepair()
    expect(repair.push('西班牙 🇪🇸 夺冠 🏆')).toBe('西班牙 🇪🇸 夺冠 🏆')
    expect(repair.flush()).toBe('')
  })

  it('代理对被从中间切开时跨增量拼回', () => {
    const repair = createStreamTextRepair()
    const flag = '🇪🇸'
    // 在第一个代理对中间切一刀：前半是孤立高位代理，需暂存等下一个增量
    expect(repair.push(flag.slice(0, 1))).toBe('')
    expect(repair.push(flag.slice(1, 2))).toBe('🇪')
    expect(repair.push(flag.slice(2))).toBe('🇸')
    expect(repair.flush()).toBe('')
  })

  it('旗帜 emoji 两个连续代理对分别切开后都能拼回', () => {
    const repair = createStreamTextRepair()
    const units = [...'🇪🇸']
    // 每个区域指示符是一个代理对，逐半切开推送
    let out = ''
    for (const unit of units) {
      out += repair.push(unit.slice(0, 1))
      out += repair.push(unit.slice(1, 2))
    }
    expect(out).toBe('🇪🇸')
  })

  it('流结束仍有残留高位代理时以替换符收尾', () => {
    const repair = createStreamTextRepair()
    expect(repair.push('abc\ud83c')).toBe('abc')
    expect(repair.flush()).toBe('\uFFFD')
  })

  it('增量内部的孤立代理项替换为 U+FFFD，不影响后续字符', () => {
    const repair = createStreamTextRepair()
    // 孤立高位代理后跟普通字符（不是低位代理）
    expect(repair.push('a\ud83cb')).toBe('a\uFFFDb')
    // 孤立低位代理
    expect(repair.push('a\udc00b')).toBe('a\uFFFDb')
    expect(repair.flush()).toBe('')
  })

  it('空增量不产生输出', () => {
    const repair = createStreamTextRepair()
    expect(repair.push('')).toBe('')
    expect(repair.flush()).toBe('')
  })
})
