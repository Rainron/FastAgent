import { describe, expect, it } from 'vitest'
import { builtinProfile } from '../../../shared/permission-profiles'
import { buildEffectiveRules } from './effective-rules'
import { resolvePermission } from './permission-engine'

describe('完全访问的有效权限', () => {
  it('覆盖保存的询问规则，保留明确禁止', () => {
    const rules = buildEffectiveRules(builtinProfile('full'), [
      { toolKey: 'external_directory', pattern: '*', action: 'ask' },
      { toolKey: 'shell', pattern: 'npm *', action: 'ask' },
      { toolKey: 'read', pattern: 'private/*', action: 'deny' }
    ])
    expect(resolvePermission('external_directory', '../.fa/skills/planning-with-files/SKILL.md', rules)).toBe('allow')
    expect(resolvePermission('shell', 'npm install', rules)).toBe('allow')
    expect(resolvePermission('read', 'private/data', rules)).toBe('deny')
    expect(resolvePermission('shell', 'rm -rf project', rules)).toBe('deny')
  })

  it('继承完全访问的档位生效，其他档位保留询问', () => {
    const rules = buildEffectiveRules({ ...builtinProfile('full'), overrides: { edit: [{ pattern: '*', action: 'ask' }] } }, [])
    expect(resolvePermission('edit', 'a.ts', rules)).toBe('allow')
    expect(resolvePermission('external_directory', '../file', buildEffectiveRules(builtinProfile('workspace'), []))).toBe('ask')
  })
})
