import { describe, expect, it } from 'vitest'
import {
  builtinProfile,
  effectiveRuleSet,
  findProfile,
  mergeProfiles,
  removeProfileRule,
  resetProfileToolKey,
  sanitizeOverrides,
  slugifyProfileId,
  upsertProfileRule,
  validateProfileDraft,
  type StoredPermissionProfile
} from './permission-profiles'
import { GLOBAL_DENY_RULES, presetRuleSet } from './permission-rules'
import { resolvePermission } from '../main/agent/permission/permission-engine'

function stored(patch: Partial<StoredPermissionProfile> = {}): StoredPermissionProfile {
  return { id: 'custom', label: '自定义', hint: '说明', base: 'workspace', builtin: false, overrides: {}, position: 0, ...patch }
}

describe('permission profiles', () => {
  it('未覆盖时生效规则等于 base 档出厂规则', () => {
    for (const base of ['ask', 'workspace', 'full'] as const) {
      const rules = effectiveRuleSet({ base, overrides: {} })
      expect(rules.edit).toEqual(presetRuleSet(base).edit)
      expect(rules.shell).toEqual(presetRuleSet(base).shell)
    }
  })

  it('overrides 按 toolKey 整键替换', () => {
    const rules = effectiveRuleSet({ base: 'ask', overrides: { edit: [{ pattern: 'src/*', action: 'allow' }] } })
    expect(rules.edit).toEqual([{ pattern: 'src/*', action: 'allow' }])
    // 没覆盖的键保持不变
    expect(rules.external_directory).toEqual(presetRuleSet('ask').external_directory)
  })

  it('档位覆盖删不掉全局禁止清单', () => {
    const rules = effectiveRuleSet({ base: 'full', overrides: { shell: [{ pattern: 'rm -rf *', action: 'allow' }, { pattern: '*', action: 'allow' }] } })
    expect(resolvePermission('shell', 'rm -rf node_modules', rules)).toBe('deny')
    expect(resolvePermission('shell', 'shutdown now', rules)).toBe('deny')
    // '*' 兜底仍是最后一条，档位默认动作不受补回 deny 的影响
    expect(rules.shell.at(-1)).toEqual({ pattern: '*', action: 'allow' })
    expect(resolvePermission('shell', 'anything else', rules)).toBe('allow')
    for (const deny of GLOBAL_DENY_RULES) expect(rules.shell).toContainEqual(deny)
  })

  it('mergeProfiles 保证内置三档在前，并锁死 base 与 builtin', () => {
    const merged = mergeProfiles([
      stored({ id: 'night', label: '夜间', position: 2 }),
      stored({ id: 'full', label: '我的完全访问', base: 'ask', builtin: false, overrides: { edit: [] } }),
      stored({ id: 'audit', label: '审计', position: 1 })
    ])
    expect(merged.map((profile) => profile.id)).toEqual(['ask', 'workspace', 'full', 'audit', 'night'])
    const full = merged[2]
    expect(full.base).toBe('full')
    expect(full.builtin).toBe(true)
    // 标签改写生效，但描述与风险标记仍来自内置元数据
    expect(full.label).toBe('我的完全访问')
    expect(full.risk).toBe(true)
    expect(full.overrides).toEqual({ edit: [] })
  })

  it('库里没有对应行时用出厂内置档', () => {
    expect(mergeProfiles([])).toEqual([builtinProfile('ask'), builtinProfile('workspace'), builtinProfile('full')])
  })

  it('自定义档的短标签与风险跟随 base', () => {
    const [, , , custom] = mergeProfiles([stored({ id: 'wild', label: '放飞', hint: '', base: 'full' })])
    expect(custom).toMatchObject({ shortLabel: '放飞', risk: true, builtin: false })
    // hint 为空时回落到 base 档描述，不留空白 tooltip
    expect(custom.description).toBe(builtinProfile('full').description)
  })

  it('findProfile 对已删除的档位回落到第一档', () => {
    const profiles = mergeProfiles([])
    expect(findProfile(profiles, 'workspace').id).toBe('workspace')
    expect(findProfile(profiles, 'deleted-mode').id).toBe('ask')
    expect(findProfile(profiles, null).id).toBe('ask')
  })

  it('规则增改删：首次编辑会把 base 规则实体化', () => {
    const profile = { base: 'ask' as const, overrides: {} }
    const added = upsertProfileRule(profile, 'shell', { pattern: 'pnpm *', action: 'allow' })
    expect(added.shell).toEqual([...presetRuleSet('ask').shell, { pattern: 'pnpm *', action: 'allow' }])

    const edited = upsertProfileRule({ base: 'ask', overrides: added }, 'shell', { pattern: 'pnpm *', action: 'deny' }, added.shell.length - 1)
    expect(edited.shell.at(-1)).toEqual({ pattern: 'pnpm *', action: 'deny' })

    const removed = removeProfileRule({ base: 'ask', overrides: edited }, 'shell', edited.shell.length - 1)
    expect(removed.shell).toEqual(presetRuleSet('ask').shell)

    expect(resetProfileToolKey({ overrides: removed }, 'shell')).toEqual({})
  })

  it('越界索引不改动规则', () => {
    const overrides = { edit: [{ pattern: '*', action: 'ask' as const }] }
    expect(removeProfileRule({ base: 'ask', overrides }, 'edit', 5)).toBe(overrides)
  })

  it('校验档位草稿', () => {
    const existing = mergeProfiles([stored({ id: 'audit', label: '审计' })])
    expect(validateProfileDraft({ id: 'night', label: '夜间', hint: '', base: 'ask' }, existing)).toBeNull()
    expect(validateProfileDraft({ id: 'night', label: ' ', hint: '', base: 'ask' }, existing)).toBe('档位名称不能为空')
    expect(validateProfileDraft({ id: 'full', label: '夜间', hint: '', base: 'ask' }, existing)).toContain('内置档位标识')
    expect(validateProfileDraft({ id: 'audit', label: '夜间', hint: '', base: 'ask' }, existing)).toContain('标识已存在')
    expect(validateProfileDraft({ id: 'night', label: '审计', hint: '', base: 'ask' }, existing)).toContain('名称已存在')
    expect(validateProfileDraft({ id: 'Night Mode', label: '夜间', hint: '', base: 'ask' }, existing)).toContain('小写字母')
  })

  it('slugify 中文标签回落到时间戳标识', () => {
    expect(slugifyProfileId('Night Mode')).toBe('night-mode')
    expect(slugifyProfileId('  read-only  ')).toBe('read-only')
    expect(slugifyProfileId('夜间')).toMatch(/^mode-[a-z0-9]+$/)
  })

  it('sanitizeOverrides 丢掉坏数据', () => {
    expect(sanitizeOverrides(null)).toEqual({})
    expect(sanitizeOverrides([])).toEqual({})
    expect(sanitizeOverrides({ edit: 'nope' })).toEqual({})
    expect(sanitizeOverrides({
      edit: [{ pattern: '*', action: 'allow' }, { pattern: '', action: 'allow' }, { pattern: 'x', action: 'maybe' }, 3]
    })).toEqual({ edit: [{ pattern: '*', action: 'allow' }] })
  })
})
