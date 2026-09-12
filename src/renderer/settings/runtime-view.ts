import type { RuntimeReport, RuntimeToolInfo, RuntimeToolSource, RuntimeToolStatus } from '../../shared/types'

export const RUNTIME_STATUS_LABEL: Record<RuntimeToolStatus, string> = {
  ready: '就绪',
  mismatch: '不一致',
  missing: '缺失'
}

export const RUNTIME_SOURCE_LABEL: Record<RuntimeToolSource, string> = {
  bundled: '内置',
  system: '系统',
  missing: '—'
}

/** 工具展示名：清单里只有 id，界面上给个更像人话的名字，认不出来的直接用 id。 */
const TOOL_LABEL: Record<string, string> = {
  rg: 'ripgrep',
  fd: 'fd',
  jq: 'jq',
  '7zz': '7-Zip',
  git: 'Git (MinGit)',
  bun: 'Bun',
  uv: 'uv'
}

export function runtimeToolLabel(id: string): string {
  return TOOL_LABEL[id] ?? id
}

/** 顶部结论。没装过与装了但有问题是两种情况，提示的下一步动作也不同。 */
export function runtimeOverallLabel(report: RuntimeReport): string {
  if (!report.tools.length) return '未安装内置工具链，Agent 将使用系统 PATH 上的工具'
  const broken = report.tools.filter((tool) => tool.status !== 'ready')
  if (!broken.length) return `全部就绪（${report.tools.length} 项${report.verified ? '，已校验' : ''}）`
  const missing = broken.filter((tool) => tool.status === 'missing').length
  const mismatch = broken.length - missing
  return [missing ? `${missing} 项缺失` : '', mismatch ? `${mismatch} 项与清单不一致` : ''].filter(Boolean).join(' · ')
}

/** 整体是否需要用户处理；决定要不要把「修复」按钮显成主操作。 */
export function runtimeNeedsRepair(report: RuntimeReport): boolean {
  return report.tools.some((tool) => tool.status !== 'ready')
}

/** 单行右侧的说明文字：就绪时给版本，异常时给原因。 */
export function runtimeToolDetail(tool: RuntimeToolInfo): string {
  if (tool.status === 'ready') return tool.version ?? '已安装'
  return tool.detail ?? RUNTIME_STATUS_LABEL[tool.status]
}
