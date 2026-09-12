import { describe, expect, it } from 'vitest'
import { evaluateCapabilities, REQUIRED_SANDBOX_VERSION, type CapabilityInput } from '../providers/windows-native/windows-capabilities'

function input(patch: Partial<CapabilityInput> = {}): CapabilityInput {
  return {
    platform: 'win32',
    runnerPresent: true,
    runnerVersion: REQUIRED_SANDBOX_VERSION,
    setup: { version: REQUIRED_SANDBOX_VERSION, offlineSid: 'S-1-5-21-1', onlineSid: 'S-1-5-21-2', createdAt: '' },
    credentialsPresent: true,
    now: 42,
    ...patch
  }
}

describe('evaluateCapabilities', () => {
  it('全部就绪时返回 ready', () => {
    const result = evaluateCapabilities(input())
    expect(result.status).toBe('ready')
    expect(result.reason).toBeNull()
    expect(result.checkedAt).toBe(42)
  })

  it('非 Windows 判为 unsupported', () => {
    expect(evaluateCapabilities(input({ platform: 'darwin' })).status).toBe('unsupported')
  })

  it('缺 runner 或缺 setup 记录判为 not_initialized', () => {
    expect(evaluateCapabilities(input({ runnerPresent: false })).status).toBe('not_initialized')
    expect(evaluateCapabilities(input({ setup: null })).status).toBe('not_initialized')
  })

  it('账户缺失或凭据缺失判为 broken', () => {
    const noAccount = evaluateCapabilities(input({ setup: { version: REQUIRED_SANDBOX_VERSION, offlineSid: '', onlineSid: 'S-1-5-21-2', createdAt: '' } }))
    expect(noAccount.status).toBe('broken')
    expect(evaluateCapabilities(input({ credentialsPresent: false })).status).toBe('broken')
  })

  it('版本低于要求判为 outdated', () => {
    expect(evaluateCapabilities(input({ runnerVersion: '0.0.9', setup: { version: '0.0.9', offlineSid: 'a', onlineSid: 'b', createdAt: '' } })).status).toBe('outdated')
  })

  it('版本高于要求仍然 ready', () => {
    expect(evaluateCapabilities(input({ runnerVersion: '1.2.0', setup: { version: '1.2.0', offlineSid: 'a', onlineSid: 'b', createdAt: '' } })).status).toBe('ready')
  })
})
