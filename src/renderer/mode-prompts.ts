import type { ConversationMode } from '../shared/types'
import { builtInModeSystemPrompts } from '../shared/mode-prompts'

export type ModePrompts = Record<ConversationMode, string>

export { builtInModeSystemPrompts }
export const defaultModePrompts: ModePrompts = { chat: '', agent: '' }
const legacyModePrompts: ModePrompts = {
  chat: '你是通用对话助手。直接回答用户问题，保持准确、清晰、简洁。当前任务不允许访问或修改本地文件，也不能执行命令。',
  agent: '你是任务执行型智能体。先理解目标并制定计划，再检查上下文、定位根因，并进行最小必要修改；改动后运行相关测试或构建来验证结果。执行操作前遵循当前权限配置，不进行未授权的高风险操作，也不访问当前工作区之外的文件。最后清楚报告执行了什么、发现了什么以及剩余问题。'
}

export function normalizeSavedModePrompt(value: unknown, mode: ConversationMode): string {
  return typeof value === 'string' && value.trim() !== legacyModePrompts[mode] ? value.trim() : ''
}

export function modePromptFor(prompts: Partial<ModePrompts>, mode: ConversationMode): string {
  return normalizeSavedModePrompt(prompts[mode], mode)
}

/** 计划模式附加指令：开启后本回合只产出实施计划，写入类工具会被主进程直接拒绝。 */
export const PLAN_MODE_PROMPT = '当前处于计划模式：先阅读相关代码与上下文，输出分步实施计划（步骤、涉及文件、验证方式）。edit、write、patch 以及 git status / git diff / git log / git show 之外的命令都会被系统直接拒绝，不要尝试，也不要在被拒绝后重试；计划经用户确认并退出计划模式后再实施。'

/** 计划模式的只读约束拼在用户自定义提示词之前，避免被用户提示词覆盖。 */
export function withPlanModePrompt(modePrompt: string, planMode: boolean): string {
  return planMode ? `${PLAN_MODE_PROMPT}\n\n${modePrompt}`.trim() : modePrompt
}

export function buildModeRuntimePrompt(modePrompt: string, prompt: string, attachmentContext = '', contextSummary = ''): string {
  const instruction = modePrompt.trim()
  const summary = contextSummary.trim()
  const summaryContext = summary ? `【已压缩上下文摘要】\n${summary}\n\n` : ''
  const modeContext = instruction ? `【用户补充提示词】\n${instruction}\n\n` : ''
  const taskLabel = instruction || summary ? '【用户任务】\n' : ''
  return `${modeContext}${summaryContext}${taskLabel}${prompt}${attachmentContext}`
}
