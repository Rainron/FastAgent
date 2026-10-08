import type { PtyProcess, PtySpawnOptions } from './pty-manager'

/**
 * node-pty 适配层。
 *
 * 原生模块在这里、且只在真正开终端时才加载：它是整个应用里唯一需要 pty 的能力，
 * 装载失败（缺二进制、ABI 不匹配）只该让终端面板报错，不该拖垮主进程启动。
 */

type NodePty = {
  spawn(file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): {
    pid: number
    write(data: string): void
    resize(cols: number, rows: number): void
    kill(): void
    onData(listener: (chunk: string) => void): unknown
    onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown
  }
}

let cached: NodePty | null = null

function load(): NodePty {
  if (cached) return cached
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('node-pty') as NodePty
  } catch (error) {
    throw new Error(`终端组件加载失败：${error instanceof Error ? error.message : String(error)}`)
  }
  return cached
}

export function spawnPty(options: PtySpawnOptions): PtyProcess {
  const pty = load().spawn(options.file, options.args, {
    // xterm-256color 让 shell 按真彩终端输出，面板用的就是 xterm.js
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env
  })
  return {
    pid: pty.pid,
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: () => pty.kill(),
    onData: (listener) => { pty.onData(listener) },
    onExit: (listener) => { pty.onExit(listener) }
  }
}
