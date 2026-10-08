/**
 * 在指定目录打开系统终端。
 *
 * 命令与参数分开传给 spawn，绝不拼一条 shell 字符串：目录名里出现空格、引号或 `&`
 * 都会变成注入点，而工作区路径完全由用户决定。
 */

export interface TerminalCommand {
  command: string
  args: string[]
}

/**
 * 每个平台按可用性从前往后试：
 * - Windows：优先 Windows Terminal（`wt -d`），退回 cmd 的 `start`（`/K cd /d` 保持窗口不关）
 * - macOS：`open -a Terminal <dir>`
 * - Linux：各家终端参数不同，逐个试常见的几个
 */
export function terminalCandidates(platform: NodeJS.Platform, cwd: string): TerminalCommand[] {
  if (platform === 'win32') {
    return [
      { command: 'wt.exe', args: ['-d', cwd] },
      // start 的第一个引号参数是窗口标题，省略会把路径当标题
      { command: 'cmd.exe', args: ['/c', 'start', '', 'cmd.exe', '/K', 'cd', '/d', cwd] }
    ]
  }
  if (platform === 'darwin') return [{ command: 'open', args: ['-a', 'Terminal', cwd] }]
  return [
    { command: 'x-terminal-emulator', args: ['--working-directory', cwd] },
    { command: 'gnome-terminal', args: ['--working-directory', cwd] },
    { command: 'konsole', args: ['--workdir', cwd] },
    { command: 'xfce4-terminal', args: ['--working-directory', cwd] },
    { command: 'xterm', args: ['-e', 'cd', cwd] }
  ]
}

type Spawn = (command: string, args: string[], options: { cwd: string; detached: boolean; stdio: 'ignore' }) => { unref(): void; on(event: 'error', listener: (error: Error) => void): void }

/**
 * 逐个候选尝试，直到有一个真正启动成功。
 * spawn 的失败是异步的（error 事件），所以每个候选都要等一小会儿再判定；
 * 全部失败时把最后一个错误报给调用方，而不是静默什么都不发生。
 */
export async function openTerminalAt(cwd: string, spawn: Spawn, platform: NodeJS.Platform = process.platform): Promise<string> {
  let lastError = '没有可用的终端程序'
  for (const candidate of terminalCandidates(platform, cwd)) {
    const failed = await new Promise<string | null>((resolve) => {
      try {
        const child = spawn(candidate.command, candidate.args, { cwd, detached: true, stdio: 'ignore' })
        child.on('error', (error) => resolve(error.message))
        // 没在这段时间里报错就认为起来了：终端窗口是独立进程，拿不到更强的成功信号。
        setTimeout(() => resolve(null), 220)
        child.unref()
      } catch (error) {
        resolve(error instanceof Error ? error.message : '终端启动失败')
      }
    })
    if (failed === null) return ''
    lastError = failed
  }
  return lastError
}
