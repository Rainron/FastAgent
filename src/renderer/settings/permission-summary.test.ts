import { describe, expect, it } from 'vitest'
import { builtinProfile, effectiveRuleSet, upsertProfileRule } from '../../shared/permission-profiles'
import { permissionProtectionSummary, permissionSummary } from './permission-summary'

describe('permission summary', () => {
  it('uses the actual fallback while preserving specific rules when editing it', () => {
    const profile = builtinProfile('workspace')
    profile.overrides.shell = [{ pattern: 'git push *', action: 'deny' }, { pattern: '*', action: 'ask' }]
    const shell = permissionSummary(profile).find((item) => item.toolKey === 'shell')!
    expect(shell.action).toBe('ask')
    profile.overrides = upsertProfileRule(profile, 'shell', { pattern: '*', action: 'allow' }, shell.index)
    expect(effectiveRuleSet(profile).shell).toContainEqual({ pattern: 'git push *', action: 'deny' })
    expect(permissionSummary(profile).find((item) => item.toolKey === 'shell')?.action).toBe('allow')
  })
  it('does not invent a default action when the profile has no wildcard', () => {
    const profile = builtinProfile('ask')
    profile.overrides.read = []
    expect(permissionSummary(profile).some((item) => item.toolKey === 'read')).toBe(false)
  })
  it('reflects the selected profile protection, including missing fallbacks', () => {
    const profile = builtinProfile('workspace')
    expect(permissionProtectionSummary(profile).find((row) => row.toolKey === 'secret_file')?.action).toBe('ask')
    profile.overrides.secret_file = [{ pattern: '*.key', action: 'deny' }]
    expect(permissionProtectionSummary(profile).find((row) => row.toolKey === 'secret_file')?.action).toBeNull()
  })
})
