/**
 * SKILL.md 前言里与执行有关的声明。
 *
 * 名称与描述由 skill-registry 解析（它是加载 Skill 的唯一入口），这里只补
 * 「跑起来需要什么」——所需工具与引用到的附属文件。两处解析都很薄，
 * 合并成一个反而会让注册表被检查逻辑拖着走。
 */

/** Agent Skills 标准里的工具声明字段；两种写法都收。 */
const ALLOWED_TOOLS_KEYS = ['allowed-tools', 'allowed_tools']

function frontmatterOf(content: string): string | null {
  return content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? null
}

/** 支持 `allowed-tools: a, b`、`[a, b]` 与 YAML 列表三种写法。 */
export function parseAllowedTools(content: string): string[] {
  const frontmatter = frontmatterOf(content)
  if (!frontmatter) return []
  const lines = frontmatter.replace(/\r\n?/g, '\n').split('\n')
  const index = lines.findIndex((line) => ALLOWED_TOOLS_KEYS.some((key) => new RegExp(`^${key}:`).test(line.trim())))
  if (index < 0) return []
  const inline = lines[index].slice(lines[index].indexOf(':') + 1).trim()
  const collected: string[] = []
  if (inline && inline !== '[]') {
    collected.push(...inline.replace(/^\[|\]$/g, '').split(','))
  }
  // 缩进的 `- 名字` 属于同一个键，直到遇到下一个顶格键。
  for (const line of lines.slice(index + 1)) {
    const item = line.match(/^\s+-\s*(.+?)\s*$/)
    if (item) { collected.push(item[1]); continue }
    if (line.trim()) break
  }
  return normalizeToolNames(collected)
}

function normalizeToolNames(values: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    const name = value.trim().replace(/^["']|["']$/g, '').trim()
    if (name) seen.add(name)
  }
  return [...seen]
}

/**
 * SKILL.md 正文里引用到的仓内相对文件（Markdown 链接与裸路径）。
 * 只收明显是相对路径的那些：外链、锚点与绝对路径不属于本 Skill 的附属文件。
 */
export function parseReferencedFiles(content: string): string[] {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  const found = new Set<string>()
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) add(found, match[1])
  for (const match of body.matchAll(/(?:^|[\s`(])((?:references|scripts|assets|templates)\/[\w./-]+)/g)) add(found, match[1])
  return [...found]
}

function add(target: Set<string>, raw: string) {
  const path = raw.trim().replace(/^\.\//, '')
  if (!path) return
  if (/^[a-z]+:/i.test(path) || path.startsWith('#') || path.startsWith('/') || path.startsWith('..')) return
  if (/^[a-zA-Z]:[\\/]/.test(path)) return
  target.add(path.split('#')[0])
}
