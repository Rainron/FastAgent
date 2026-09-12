import { existsSync, realpathSync } from 'node:fs'
import * as path from 'node:path'

export interface ResolvedToolPath {
  /** 解析后的绝对路径（经过 realpath） */
  absolutePath: string
  /** 相对 workspaceRoot 的路径；越界时会出现 .. */
  relativePath: string
  external: boolean
}

/** UNC（\\?\、\\server\share）一律判为外部；POSIX 上反斜杠形态同样按外部处理（fail-closed）。 */
function isUncPath(input: string): boolean {
  return input.startsWith('\\\\?\\') || input.startsWith('\\\\')
}

/** 目标不存在时取最近存在的父目录做 realpath，再拼回剩余部分。 */
function realpathNearest(target: string): string {
  const missing: string[] = []
  let current = target
  while (!existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(target)
    missing.unshift(path.basename(current))
    current = parent
  }
  return missing.length ? path.join(realpathSync.native(current), ...missing) : realpathSync.native(current)
}

export function resolveToolPath(inputPath: string, workspaceRoot: string): ResolvedToolPath {
  const input = String(inputPath ?? '').trim()
  const root = path.resolve(workspaceRoot || '')
  if (!input) {
    return { absolutePath: root, relativePath: '.', external: false }
  }
  if (isUncPath(input)) {
    return { absolutePath: input, relativePath: input, external: true }
  }
  const rootReal = realpathNearest(root)
  const absolute = path.resolve(root, input)
  const targetReal = realpathNearest(absolute)
  const relative = path.relative(rootReal, targetReal)
  // 不同盘符/完全无关的路径，path.relative 会返回绝对路径
  const external = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  return { absolutePath: targetReal, relativePath: relative, external }
}