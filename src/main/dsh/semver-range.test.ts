import { describe, expect, it } from 'vitest'
import { satisfiesRange } from './semver-range'

describe('satisfiesRange', () => {
  it('0.x 的 ^ 只放行同一个次版本', () => {
    expect(satisfiesRange('^0.1.7', '0.1.9')).toBe(true)
    expect(satisfiesRange('^0.1.7', '0.1.5')).toBe(false)
    expect(satisfiesRange('^0.1.7', '0.2.0')).toBe(false)
    expect(satisfiesRange('^0.0.3', '0.0.4')).toBe(false)
  })

  it('1.x 以上的 ^ 与 ~', () => {
    expect(satisfiesRange('^4.0.1', '4.0.2')).toBe(true)
    expect(satisfiesRange('^4.0.1', '5.0.0')).toBe(false)
    expect(satisfiesRange('~4.0.0', '4.0.9')).toBe(true)
    expect(satisfiesRange('~4.0.0', '4.1.0')).toBe(false)
  })

  it('|| 任一分支满足即可', () => {
    const range = '^0.1.0-rc.6 || ^0.1.5-alpha.1 || ^0.1.7-alpha.1'
    expect(satisfiesRange(range, '0.1.5-rc.2')).toBe(true)
    expect(satisfiesRange('^0.1.7-rc.1 || ^0.2.0-rc.1', '0.1.5-rc.2')).toBe(false)
    expect(satisfiesRange('^0.1.7-rc.1 || ^0.2.0-rc.1', '0.2.0-rc.3')).toBe(true)
  })

  it('预发布版只被点名同一版本三元组的区间接受', () => {
    expect(satisfiesRange('^0.1.0', '0.1.5-rc.2')).toBe(false)
    expect(satisfiesRange('^0.1.5-alpha.1', '0.1.5-rc.2')).toBe(true)
    expect(satisfiesRange('^0.1.5-rc.10', '0.1.5-rc.2')).toBe(false)
    expect(satisfiesRange('^4.0.1-rc.1', '4.0.2')).toBe(true)
  })

  it('判断已有版本时可按大小接受预发布版', () => {
    expect(satisfiesRange('^0.1.0-rc.8', '0.1.5-rc.2')).toBe(false)
    expect(satisfiesRange('^0.1.0-rc.8', '0.1.5-rc.2', { includePrerelease: true })).toBe(true)
    expect(satisfiesRange('^0.1.7-rc.1 || ^0.2.0-rc.1', '0.1.5-rc.2', { includePrerelease: true })).toBe(false)
  })

  it('比较符组合、x-range 与连字符区间', () => {
    expect(satisfiesRange('>=0.2.0-rc.1 <0.3.0-0', '0.2.4')).toBe(true)
    expect(satisfiesRange('>=0.2.0-rc.1 <0.3.0-0', '0.3.0')).toBe(false)
    expect(satisfiesRange('>= 4.0.0', '4.0.2')).toBe(true)
    expect(satisfiesRange('4.x', '4.9.1')).toBe(true)
    expect(satisfiesRange('4', '5.0.0')).toBe(false)
    expect(satisfiesRange('*', '1.2.3')).toBe(true)
    expect(satisfiesRange('', '1.2.3')).toBe(true)
    expect(satisfiesRange('1.0.0 - 2.0.0', '2.0.0')).toBe(true)
    expect(satisfiesRange('4.0.2', '4.0.2')).toBe(true)
    expect(satisfiesRange('4.0.2', '4.0.3')).toBe(false)
  })

  it('看不懂的写法返回 null，不冒充「不满足」', () => {
    expect(satisfiesRange('workspace:*', '1.0.0')).toBeNull()
    expect(satisfiesRange('github:foo/bar', '1.0.0')).toBeNull()
    expect(satisfiesRange('^1.0.0', 'not-a-version')).toBeNull()
  })
})
