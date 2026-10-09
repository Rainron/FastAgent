import { describe, expect, it } from 'vitest'
import { uniqueConnectionName } from './model-connections-names'

describe('uniqueConnectionName', () => {
  it('不冲突时原样返回，并去掉首尾空白', () => {
    expect(uniqueConnectionName(' DeepSeek ', new Set())).toBe('DeepSeek')
  })
  it('冲突时逐级追加序号', () => {
    expect(uniqueConnectionName('DeepSeek', new Set(['DeepSeek']))).toBe('DeepSeek (2)')
    expect(uniqueConnectionName('DeepSeek', new Set(['DeepSeek', 'DeepSeek (2)']))).toBe('DeepSeek (3)')
  })
  it('空名字回落到默认名', () => {
    expect(uniqueConnectionName('  ', new Set())).toBe('模型服务')
  })
})
