/**
 * 日志目录解析。
 *
 * 首选安装目录下的 logs：出问题时用户能在自己装程序的地方直接找到日志，
 * 不用被指引到 %APPDATA% 那种藏起来的路径。但安装目录不保证可写——
 * NSIS 配置允许用户改装到 Program Files，那里不提权写不进去，所以必须探测后回落。
 */
import { accessSync, constants, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface LogLocation {
  dir: string
  /** 是否没能用上首选目录；崩溃报告头部会标注，避免事后对着空目录找日志。 */
  fallback: boolean
  reason: string | null
}

export interface LogDirOptions {
  packaged: boolean
  /** app.getPath('exe') */
  execPath: string
  /** app.getAppPath() */
  projectRoot: string
  /** app.getPath('logs')，回落目标 */
  userDataLogs: string
  probe?: (dir: string) => boolean
}

/** 目录能建出来且可写才算数；只判断 existsSync 会漏掉「存在但只读」。 */
export function canWriteDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function resolveLogDir(options: LogDirOptions): LogLocation {
  const probe = options.probe ?? canWriteDir
  // 开发态 exe 是 node_modules/electron/dist/electron.exe，往那写等于污染依赖目录。
  const preferred = options.packaged
    ? join(dirname(options.execPath), 'logs')
    : join(options.projectRoot, 'logs')
  if (probe(preferred)) return { dir: preferred, fallback: false, reason: null }
  if (probe(options.userDataLogs)) {
    return { dir: options.userDataLogs, fallback: true, reason: `首选目录不可写：${preferred}` }
  }
  // 两处都写不进就只能认了，交给调用方；写入侧本来就对失败免疫。
  return { dir: options.userDataLogs, fallback: true, reason: `首选目录与回落目录均不可写：${preferred}` }
}
