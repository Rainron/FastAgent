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

/** 目标不存在时取最近存在的父目录做 realpath，再拼回剩余部分；权限不足时保留规范化的词法路径。 */
function realpathNearest(target: string): string {
  const missing: string[] = []
  let current = target
  while (!existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(target)
    missing.unshift(path.basename(current))
    current = parent
  }
  try {
    const resolved = realpathSync.native(current)
    return missing.length ? path.join(resolved, ...missing) : resolved
  } catch {
    // 沙箱账户可能只能访问工作区本身，无法 realpath 宿主用户目录；
    // 词法路径仍可用于越界判断，不能因为解析失败把正常工具调用变成异常。
    return path.resolve(target)
  }
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
  // 工作区内返回词法路径，避免 Windows 短路径/长路径转换污染变更账本；
  // 越界判定仍使用 realpath 后的 canonical 路径。
  return { absolutePath: external ? targetReal : absolute, relativePath: relative, external }
}