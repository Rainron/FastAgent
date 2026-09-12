import type { DoctorCategory, DoctorCheck, DoctorReport, DoctorStatus } from '../../shared/types'

export const STATUS_LABEL: Record<DoctorStatus, string> = {
  ok: '正常',
  warn: '提示',
  missing: '缺失',
  error: '异常'
}

export const CATEGORY_LABEL: Record<DoctorCategory, string> = {
  toolchain: '开发工具',
  shell: 'Shell',
  sandbox: '沙箱',
  workspace: '工作区',
  abilities: '能力'
}

/** 分组顺序固定，不按 Map 插入序：探测是并行的，返回顺序不稳定。 */
const CATEGORY_ORDER: DoctorCategory[] = ['toolchain', 'shell', 'sandbox', 'workspace', 'abilities']

export function groupChecks(checks: readonly DoctorCheck[]): Array<[DoctorCategory, DoctorCheck[]]> {
  const groups = new Map<DoctorCategory, DoctorCheck[]>()
  for (const check of checks) {
    const list = groups.get(check.category)
    if (list) list.push(check)
    else groups.set(check.category, [check])
  }
  return CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => [category, groups.get(category) as DoctorCheck[]])
}

/** 顶部结论一句话。全部正常时不啰嗦，有问题时直接给出各档计数。 */
export function overallLabel(report: Pick<DoctorReport, 'overall' | 'summary'>): string {
  if (report.overall === 'ok') return `全部正常（${report.summary.ok} 项）`
  const parts: string[] = []
  if (report.summary.error) parts.push(`${report.summary.error} 项异常`)
  if (report.summary.missing) parts.push(`${report.summary.missing} 项缺失`)
  if (report.summary.warn) parts.push(`${report.summary.warn} 项提示`)
  return parts.join(' · ')
}
