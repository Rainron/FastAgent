/**
 * 内嵌终端拉起哪个 shell。
 *
 * 与 agent 的 shell 工具共用用户在设置里选的偏好：用户把命令执行设成 bash 时，
 * 手敲命令的终端也该是 bash，否则同一条命令在两处行为不一致。
 */

export interface ShellChoice {
  file: string
  args: string[]
}

export interface ShellChoiceInput {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  /** 设置里的命令执行偏好；bash 只有在拿得到可执行文件时才生效。 */
  prefer?: 'bash' | 'powershell'
  bashPath?: string | null
}

export function defaultShell({ platform, env, prefer, bashPath }: ShellChoiceInput): ShellChoice {
  const bash = bashPath?.trim()
  if (prefer === 'bash' && bash) return { file: bash, args: ['-i', '-l'] }
  if (platform === 'win32') {
    // -NoLogo 去掉每次开窗的版权横幅；COMSPEC 只在 PowerShell 缺失的系统上兜底。
    return env.FASTAGENT_TERMINAL_SHELL?.trim()
      ? { file: env.FASTAGENT_TERMINAL_SHELL.trim(), args: [] }
      : { file: 'powershell.exe', args: ['-NoLogo'] }
  }
  const login = env.FASTAGENT_TERMINAL_SHELL?.trim() || env.SHELL?.trim() || '/bin/bash'
  return { file: login, args: ['-l'] }
}
