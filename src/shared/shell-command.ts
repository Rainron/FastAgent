import type { ShellCommandOutputMode, ShellCommandResult, ShellCommandSettings } from './types'

/** 输出上限：命令跑飞时（cat 大文件、循环打印）不能把渲染进程的一条消息撑爆。 */
export const MAX_SHELL_COMMAND_OUTPUT = 64 * 1024
export const MIN_SHELL_COMMAND_TIMEOUT = 1
export const MAX_SHELL_COMMAND_TIMEOUT = 600

export const DEFAULT_SHELL_COMMAND_SETTINGS: ShellCommandSettings = {
  enabled: true,
  output: 'local',
  timeoutSeconds: 60
}

const OUTPUT_MODES: ShellCommandOutputMode[] = ['local', 'context', 'composer']

export function normalizeShellCommandSettings(input: Partial<ShellCommandSettings> | undefined): ShellCommandSettings {
  const timeout = input?.timeoutSeconds
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : DEFAULT_SHELL_COMMAND_SETTINGS.enabled,
    output: input?.output && OUTPUT_MODES.includes(input.output) ? input.output : DEFAULT_SHELL_COMMAND_SETTINGS.output,
    timeoutSeconds: typeof timeout === 'number' && Number.isFinite(timeout)
      ? Math.min(MAX_SHELL_COMMAND_TIMEOUT, Math.max(MIN_SHELL_COMMAND_TIMEOUT, Math.round(timeout)))
      : DEFAULT_SHELL_COMMAND_SETTINGS.timeoutSeconds
  }
}

/**
 * 取出 `!` 前缀命令。只认行首的单个 `!`，后面必须有非空内容；
 * `!!` 视为转义，返回 null 让文本按普通消息发出去（历史上 `!` 开头的正常提问不该被劫持）。
 */
export function parseShellCommandInput(text: string): string | null {
  if (!text.startsWith('!') || text.startsWith('!!')) return null
  const command = text.slice(1).trim()
  return command ? command : null
}

/** `!!foo` 是「我真的想发一条以 ! 开头的消息」，发送前去掉转义用的第一个 `!`。 */
export function unescapeShellCommandInput(text: string, enabled = true): string {
  return enabled && text.startsWith('!!') ? text.slice(1) : text
}

/** 超出上限时丢弃最早的部分：命令的结论通常在末尾。 */
export function truncateShellOutput(text: string, max = MAX_SHELL_COMMAND_OUTPUT): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: text.slice(text.length - max), truncated: true }
}

export function shellCommandStatusLabel(result: Pick<ShellCommandResult, 'status' | 'exitCode'>): string {
  if (result.status === 'cancelled') return '已终止'
  if (result.status === 'timeout') return '已超时'
  if (result.status === 'failed') return result.exitCode === null ? '执行失败' : `执行失败，退出码 ${result.exitCode}`
  return result.exitCode === 0 ? '退出码 0' : `退出码 ${result.exitCode ?? '未知'}`
}

/** context / composer 两种落点共用的文本形态：命令 + 输出围栏，模型与用户读到的是同一份。 */
export function formatShellCommandOutput(result: ShellCommandResult): string {
  const body = result.output.trim() || '（无输出）'
  const notes = [shellCommandStatusLabel(result)]
  if (result.truncated) notes.push('输出过长，已保留末尾部分')
  if (result.error) notes.push(result.error)
  const longestFence = Math.max(2, ...(`${result.command}\n${body}`.match(/`+/g) ?? []).map((match) => match.length))
  const fence = '`'.repeat(longestFence + 1)
  return [`${fence}console`, `$ ${result.command}`, body, fence, `（${notes.join('；')}）`].join('\n')
}
