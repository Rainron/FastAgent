export interface FileReference {
  path: string
  line: number | null
  endLine: number | null
}

const REFERENCE = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/

/**
 * 只接受工作区内的相对路径：绝对路径、盘符、UNC、以及任何 .. 段都拒绝。
 * 这是渲染层的第一道闸，真正的越界拦截在主进程 workspace:read-file 里用 realpath 做。
 */
export function isWorkspaceRelativePath(path: string): boolean {
  if (!path || path.length > 512) return false
  if (path.startsWith('/') || path.startsWith('\\')) return false
  if (WINDOWS_DRIVE.test(path)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false
  const segments = path.split(/[\\/]+/)
  if (segments.some((segment) => segment === '..')) return false
  return segments.every((segment) => segment !== '' || segments.length === 1)
}

/** 解析 `src/main.ts` / `src/main.ts:42` / `src/main.ts:42-68`；不是合法工作区路径时返回 null。 */
export function parseFileReference(token: string): FileReference | null {
  const trimmed = token.trim()
  if (!trimmed) return null
  const match = REFERENCE.exec(trimmed)
  if (!match) return null
  const path = match[1]
  if (!isWorkspaceRelativePath(path)) return null
  // 必须像个文件：带扩展名或带目录分隔符，否则 `useState:1` 这类普通行内代码会被误判。
  if (!/[\\/]/.test(path) && !/\.[A-Za-z0-9]{1,8}$/.test(path)) return null
  const line = match[2] ? Number(match[2]) : null
  const endLine = match[3] ? Number(match[3]) : null
  if (line !== null && (!Number.isSafeInteger(line) || line < 1)) return null
  if (endLine !== null && (!Number.isSafeInteger(endLine) || endLine < (line ?? 1))) return null
  return { path, line, endLine }
}

export function formatFileReference(reference: FileReference): string {
  if (reference.line === null) return reference.path
  return reference.endLine === null ? `${reference.path}:${reference.line}` : `${reference.path}:${reference.line}-${reference.endLine}`
}
