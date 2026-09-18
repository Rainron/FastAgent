import { effectiveRuleSet, type StoredPermissionProfile } from '../../../shared/permission-profiles'
import type { PermissionRule, PermissionRuleSet } from '../../../shared/permission-rules'

const FULL_ACCESS_KEYS = new Set(['read', 'search', 'edit', 'shell', 'mcp_read', 'mcp_write', 'external_directory', 'secret_file'])

export function buildEffectiveRules(
  profile: Pick<StoredPermissionProfile, 'base' | 'overrides'>,
  savedRules: readonly (PermissionRule & { toolKey: string })[],
  additionalRules: PermissionRuleSet = {}
): PermissionRuleSet {
  const merged = { ...effectiveRuleSet(profile), ...additionalRules }
  for (const rule of savedRules) {
    merged[rule.toolKey] = [...(merged[rule.toolKey] ?? []), { pattern: rule.pattern, action: rule.action }]
  }
  if (profile.base === 'full') {
    for (const [key, rules] of Object.entries(merged)) {
      if (FULL_ACCESS_KEYS.has(key)) merged[key] = rules.map((rule) => rule.action === 'ask' ? { ...rule, action: 'allow' } : rule)
    }
  }
  return merged
}
