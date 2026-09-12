import { describe, expect, it } from 'vitest'
import { compareVersions, isNewerVersion } from './semver'

describe('semver', () => {
  it('按数字主干比较，缺省段补零', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('2', '1.99.99')).toBe(1)
    expect(compareVersions('v1.0', '1.0.0')).toBe(0)
  })

  it('预发布版低于同主干的正式版', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
  })

  it('任一版本缺失时不判为有更新', () => {
    expect(isNewerVersion('2.0.0', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(false)
    expect(isNewerVersion(undefined, '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', undefined)).toBe(false)
  })
})
