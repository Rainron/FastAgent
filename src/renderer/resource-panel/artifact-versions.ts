import type { Artifact, FileVersionRecord } from '../../shared/types'

const OPERATION_LABELS: Record<FileVersionRecord['operation'], string> = {
  create: '新建',
  update: '修改',
  delete: '删除',
  rename: '重命名'
}

export function versionOperationLabel(version: Pick<FileVersionRecord, 'operation'>): string {
  return OPERATION_LABELS[version.operation]
}

/** 增删行数摘要；两者都是 0（二进制 / 超大文件）时不编造数字。 */
export function versionStatsLabel(version: Pick<FileVersionRecord, 'additions' | 'deletions'>): string {
  const parts: string[] = []
  if (version.additions) parts.push(`+${version.additions}`)
  if (version.deletions) parts.push(`-${version.deletions}`)
  return parts.join(' ')
}

/** 恢复入口的可用性与禁用原因；禁用时必须说清为什么，不能只是灰着。 */
export function restoreAvailability(version: Pick<FileVersionRecord, 'canRestore'>): { enabled: boolean; reason: string } {
  return version.canRestore
    ? { enabled: true, reason: '恢复到这次改动之前的内容' }
    : { enabled: false, reason: '这一版没有留下改动前的原文（旧记录或二进制文件），无法恢复' }
}

/** 「继续修改」送进输入框的提示；路径用 @ 引用，走既有的文件补全语义。 */
export function continueEditPrompt(path: string): string {
  return `继续修改 @${path}：`
}

/**
 * 成果的来源说明：登记它的工具、所属会话与委派任务。
 * taskId / agentRunId 一直在库里，只是过去没有展示入口——「可定位来源任务」是 F06 的验收项。
 */
export function artifactOriginLabel(artifact: Pick<Artifact, 'source' | 'taskId' | 'agentRunId'>): string {
  const parts: string[] = []
  if (artifact.source) parts.push(`由 ${artifact.source} 写出`)
  if (artifact.taskId) parts.push('来自子任务委派')
  if (!parts.length) return artifact.agentRunId ? '由 Agent 运行写出' : '来源未记录'
  return parts.join(' · ')
}
