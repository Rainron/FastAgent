import type { SkillCheckIssue, SkillCheckResult } from '../../../shared/types'
import { parseAllowedTools, parseReferencedFiles } from './skill-manifest'

/**
 * Skill 静态校验。
 *
 * 这不是试运行：不启动模型、不执行脚本，只检查「按现在的配置跑起来会不会直接缺东西」。
 * 命名上必须与试运行区分开——一次静态检查通过不代表这个 Skill 真的能完成任务。
 */
export interface SkillCheckInput {
  name: string
  /** SKILL.md 全文。 */
  content: string
  /** 目录名，用于校验与 frontmatter 的 name 是否一致。 */
  directoryName: string
  /** 目录内的相对文件路径。 */
  files: readonly string[]
  /** 当前环境可用的工具名。 */
  availableTools: readonly string[]
}

function issue(level: SkillCheckIssue['level'], message: string, hint?: string): SkillCheckIssue {
  return hint ? { level, message, hint } : { level, message }
}

export function checkSkill(input: SkillCheckInput): SkillCheckResult {
  const issues: SkillCheckIssue[] = []
  const requiredTools = parseAllowedTools(input.content)
  const available = new Set(input.availableTools)
  const missingTools = requiredTools.filter((tool) => !available.has(tool))

  if (!/^---\r?\n/.test(input.content)) {
    issues.push(issue('error', 'SKILL.md 缺少 YAML 前言', '文件必须以 --- 开头，并至少声明 name 与 description'))
  }
  if (input.name !== input.directoryName) {
    issues.push(issue('error', `前言里的 name（${input.name}）与目录名（${input.directoryName}）不一致`, '启用状态按目录名保存，不一致会导致启停对不上'))
  }
  if (!requiredTools.length) {
    issues.push(issue('info', '没有声明 allowed-tools', '不声明不影响运行，但缺少工具时无法提前提示'))
  }
  for (const tool of missingTools) {
    issues.push(issue('error', `所需工具不可用：${tool}`, '在能力页启用对应的 MCP Server / CLI 工具，或修改 allowed-tools'))
  }

  const fileSet = new Set(input.files)
  for (const reference of parseReferencedFiles(input.content)) {
    if (fileSet.has(reference)) continue
    issues.push(issue('warning', `正文引用的文件不存在：${reference}`, '模型按需读取正文里的路径，读不到就会中断这条支线'))
  }

  const scripts = input.files.filter((file) => /\.(js|mjs|cjs|ts|py|sh|ps1|bat|cmd)$/i.test(file))
  if (scripts.length && !available.has('shell')) {
    issues.push(issue('warning', `包含 ${scripts.length} 个脚本文件，但当前没有可用的 Shell 工具`, '脚本执行仍走 Agent 的工具权限与沙箱，不会因导入 Skill 获得额外权限'))
  }

  return {
    ok: issues.every((item) => item.level !== 'error'),
    requiredTools,
    missingTools,
    issues
  }
}
