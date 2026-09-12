/** 展示层路径收敛：绝对路径折成工作区相对路径，无法相对化时只留文件名。 */
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/
/** 单一根斜杠、UNC、主目录都算绝对起点。 */
const ABSOLUTE_START = /^(?:[\\/]|~[\\/])/

export function isAbsolutePath(path: string): boolean {
  const trimmed = path.trim()
  if (!trimmed) return false
  return WINDOWS_DRIVE.test(trimmed) || ABSOLUTE_START.test(trimmed)
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * workspaceRoot 已知且路径在其下 → 相对路径；路径就是根 → 空串（根部对用户无信息量）；
 * 其余绝对路径 → 只剩文件名，不把磁盘完整布局摊在界面上。
 */
export function displayPath(path: string, workspaceRoot: string | null): string {
  const normalized = normalizeSlashes(path.trim())
  if (!isAbsolutePath(normalized)) return normalized.replace(/^\.\//, '')
  if (workspaceRoot) {
    const root = normalizeSlashes(workspaceRoot.trim()).replace(/\/+$/, '')
    if (!root || normalized === root) return ''
    const prefix = `${root}/`
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length)
  }
  const segments = normalized.split('/').filter(Boolean)
  return segments.length ? segments[segments.length - 1] : normalized
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 把嵌在文本里的工作区根收敛掉（命令行是主要场景：`cd K:/x/y && ls` 里的路径不是整串）。
 * 根加分隔符 → 只留相对部分；根单独出现 → 折成 `.`，命令按 cwd 读语义仍然成立。
 * 两种分隔符都匹配，Windows 盘符大小写不敏感。
 */
export function stripWorkspaceRoot(value: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return value
  const root = normalizeSlashes(workspaceRoot.trim()).replace(/\/+$/, '')
  if (!root) return value
  const source = escapeRegExp(root).replace(/\//g, '[\\\\/]')
  return value
    .replace(new RegExp(`${source}[\\\\/]`, 'gi'), '')
    .replace(new RegExp(`${source}(?![\\w])`, 'gi'), '.')
}

/** 整串就是绝对路径时收敛（用于入参值、路径工具摘要等），其余字符串只收敛嵌入的工作区根。 */
export function displayPathValue(value: string, workspaceRoot: string | null): string {
  return isAbsolutePath(value) ? displayPath(value, workspaceRoot) : stripWorkspaceRoot(value, workspaceRoot)
}