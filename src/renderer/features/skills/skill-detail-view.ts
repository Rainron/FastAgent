import type { SkillCheckResult, SkillVersionRecord } from '../../../shared/types'

const REASON_LABELS: Record<SkillVersionRecord['reason'], string> = {
  edit: '编辑前',
  import: '覆盖导入前',
  revert: '回退前'
}

export function versionReasonLabel(version: Pick<SkillVersionRecord, 'reason'>): string {
  return REASON_LABELS[version.reason]
}

/** 版本行的一句说明：修订号 + 触发动作 + 前言里标注的版本号（有才显示）。 */
export function describeSkillVersion(version: SkillVersionRecord): string {
  const marks = [`#${version.revision}`, versionReasonLabel(version)]
  if (version.version) marks.push(`v${version.version}`)
  return marks.join(' · ')
}

/** 工具依赖摘要。未声明与「声明了但缺」是两回事，不能混成一句。 */
export function describeToolRequirements(detail: { requiredTools: string[]; missingTools: string[] }): string {
  if (!detail.requiredTools.length) return '未声明 allowed-tools'
  if (!detail.missingTools.length) return `${detail.requiredTools.join('、')}（均可用）`
  return `${detail.requiredTools.join('、')}；缺少 ${detail.missingTools.join('、')}`
}

/** 校验结论的一句话。措辞必须挡住「校验通过 = 能用」的误读。 */
export function describeCheckResult(result: SkillCheckResult): string {
  const errors = result.issues.filter((item) => item.level === 'error').length
  const warnings = result.issues.filter((item) => item.level === 'warning').length
  if (errors) return `${errors} 项阻塞问题${warnings ? `，${warnings} 项提醒` : ''}`
  if (warnings) return `配置可用，另有 ${warnings} 项提醒`
  return '配置与依赖检查通过（未实际执行）'
}
