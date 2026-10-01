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

/** IPv4 点分四段：`10.101.3.87` 这种整段都是数字与点。 */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/
/** 常见于日志里的主机名后缀；带端口出现时几乎可以确定不是文件。 */
const HOST_SUFFIX = /\.(com|cn|net|org|io|dev|local|localhost|internal)$/i

/**
 * 判断「路径 + 冒号数字」其实是 host:port。
 * 只在没有目录分隔符时才有意义——真实文件路径基本都带分隔符。
 */
function looksLikeHost(path: string, port: string | undefined): boolean {
  if (IPV4.test(path)) return true
  if (!port) return false
  const value = Number(port)
  // 端口范围内的数字 + 域名形状，按主机处理；行号超过 65535 的文件极少见，宁可让它当行号。
  return Number.isSafeInteger(value) && value >= 1 && value <= 65535 && HOST_SUFFIX.test(path)
}

/** 解析 `src/main.ts` / `src/main.ts:42` / `src/main.ts:42-68`；不是合法工作区路径时返回 null。 */
export function parseFileReference(token: string): FileReference | null {
  const trimmed = token.trim()
  if (!trimmed) return null
  const match = REFERENCE.exec(trimmed)
  if (!match) return null
  const path = match[1]
  if (!isWorkspaceRelativePath(path)) return null
  // 主机名不是文件：`10.101.3.87:1000` 会被当成「路径 10.101.3.87 + 行号 1000」，
  // `.87` 还正好符合扩展名形状。域名与 IP 一律排除，端口号也不该当行号。
  if (!/[\\/]/.test(path) && looksLikeHost(path, match[2])) return null
  // 必须像个文件：带目录分隔符，或带一个「至少含一个字母」的扩展名。
  // 扩展名要求字母是为了挡掉 IPv4 与 `1.0.0` 这类版本号——纯数字后缀从来不是文件类型。
  if (!/[\\/]/.test(path) && !/\.[A-Za-z0-9]{0,7}[A-Za-z][A-Za-z0-9]{0,7}$/.test(path)) return null
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
