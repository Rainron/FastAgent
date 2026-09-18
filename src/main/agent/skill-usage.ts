import { basename, dirname, sep } from 'node:path'

/**
 * 「这次工具调用用到了哪个 Skill」。
 *
 * pi 没有 skill 工具：Skill 的描述随系统提示注入，正文由模型自己用 read 拉 SKILL.md。
 * 所以使用记录只能从「读了哪个 Skill 目录下的文件」反推——命中 Skill 目录（含子文件，
 * 例如 references/*.md）就算这一轮用到了它。
 */
export function skillIdForPaths(paths: readonly string[], skillManifestPaths: readonly string[]): string | null {
  if (!paths.length || !skillManifestPaths.length) return null
  for (const manifest of skillManifestPaths) {
    const directory = dirname(normalize(manifest))
    const name = basename(directory)
    if (!name) continue
    if (paths.some((path) => isInside(normalize(path), directory))) return name
  }
  return null
}

/** Windows 上大小写不敏感，反斜杠与正斜杠混用也很常见，比较前统一。 */
function normalize(path: string): string {
  const unified = path.replace(/[\\/]+/g, sep).replace(new RegExp(`\\${sep}+$`), '')
  return process.platform === 'win32' ? unified.toLowerCase() : unified
}

function isInside(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}${sep}`)
}
