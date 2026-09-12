import type { PermissionAction, PermissionRule, PermissionRuleSet } from '../../../shared/permission-rules'
import { matchPattern } from '../../../shared/pattern-matcher'

/**
 * 解析某次工具调用的权限动作。
 *
 * 规则按数组顺序匹配，最后一条命中的规则获胜（last-match-wins）；无命中回落到该工具的
 * '*' 规则，再回落到全局 '*' 键的规则（同样按 last-match-wins 与 '*' 兜底）。全部落空时
 * fail-closed 返回 deny。
 */
export function resolvePermission(toolKey: string, subject: string, ruleSet: PermissionRuleSet): PermissionAction {
  const nested = (rules: PermissionRule[] | undefined): PermissionAction | undefined => {
    if (!rules) return undefined
    for (let index = rules.length - 1; index >= 0; index--) {
      const rule = rules[index]
      if (rule.pattern !== '*' && matchPattern(rule.pattern, subject)) return rule.action
    }
    for (let index = rules.length - 1; index >= 0; index--) {
      if (rules[index].pattern === '*') return rules[index].action
    }
    return undefined
  }
  return nested(ruleSet[toolKey]) ?? nested(ruleSet['*']) ?? 'deny'
}