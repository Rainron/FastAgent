import { effectiveRuleSet, type PermissionProfile } from '../../shared/permission-profiles'
import type { LogicalToolKey } from '../../shared/permission-rules'

const summaryTools: LogicalToolKey[] = ['read', 'edit', 'shell', 'external_directory']

const protectionTools: Array<{ toolKey: LogicalToolKey; label: string; description: string }> = [
  { toolKey: 'external_directory', label: '工作区外路径', description: '访问项目目录之外文件时的默认动作' },
  { toolKey: 'secret_file', label: '敏感文件保护', description: '敏感文件的默认动作，私钥等具体规则另行匹配' },
  { toolKey: 'shell', label: '命令执行', description: '未命中特定命令规则时的默认动作' }
]

export function permissionProtectionSummary(profile: PermissionProfile) {
  const effective = effectiveRuleSet(profile)
  return protectionTools.map((item) => {
    const rules = effective[item.toolKey] ?? []
    const index = rules.map((rule) => rule.pattern).lastIndexOf('*')
    return { ...item, action: index < 0 ? null : rules[index].action }
  })
}

export function permissionSummary(profile: PermissionProfile) {
  const effective = effectiveRuleSet(profile)
  return summaryTools.flatMap((toolKey) => {
    const rules = effective[toolKey] ?? []
    const index = rules.map((rule) => rule.pattern).lastIndexOf('*')
    return index < 0 ? [] : [{ toolKey, index, action: rules[index].action }]
  })
}
