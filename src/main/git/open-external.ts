import { spawn } from 'node:child_process'
import { shell } from 'electron'

/** 各平台的终端候选，按顺序尝试；第一个能起来的就用它。 */
export function terminalCandidates(platform: NodeJS.Platform): Array<{ command: string; args: (cwd: string) => string[] }> {
  if (platform === 'win32') {
    return [
      { command: 'wt.exe', args: (cwd) => ['-d', cwd] },
      // start 的第一个引号参数是窗口标题，省略会把路径当标题。
      { command: 'cmd.exe', args: (cwd) => ['/c', 'start', '', 'cmd.exe', '/K', `cd /d "${cwd}"`] }
    ]
  }
  if (platform === 'darwin') return [{ command: 'open', args: (cwd) => ['-a', 'Terminal', cwd] }]
  return [
    { command: 'x-terminal-emulator', args: (cwd) => ['--working-directory', cwd] },
    { command: 'gnome-terminal', args: (cwd) => ['--working-directory', cwd] },
    { command: 'konsole', args: (cwd) => ['--workdir', cwd] },
    { command: 'xterm', args: () => [] }
  ]
}

function trySpawn(command: string, args: string[], cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false })
      child.once('error', () => resolve(false))
      // 进程起来后就不再关心它的生命周期，解除引用免得阻塞退出。
      child.once('spawn', () => { child.unref(); resolve(true) })
    } catch {
      resolve(false)
    }
  })
}

/** 在工作区目录打开系统终端；全部候选都失败时退回用文件管理器打开目录。 */
export async function openInTerminal(root: string): Promise<{ ok: boolean; error?: string }> {
  for (const candidate of terminalCandidates(process.platform)) {
    if (await trySpawn(candidate.command, candidate.args(root), root)) return { ok: true }
  }
  const failure = await shell.openPath(root)
  return failure ? { ok: false, error: failure } : { ok: true }
}
