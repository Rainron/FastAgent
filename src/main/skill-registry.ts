import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, relative as relativePath, resolve, sep } from 'node:path'
import { unzipSync } from 'fflate'

export interface SkillStateStore {
  isSkillEnabled(name: string): boolean
  setSkillEnabled(name: string, enabled: boolean): void
  removeSkillState(name: string): void
}

export interface LocalSkillRecord {
  name: string
  description: string
  filePath: string
  enabled: boolean
  version?: string
  author?: string
}

export interface LocalSkillInput {
  name: string
  description: string
  instructions: string
}

export type SkillConflictStrategy = 'overwrite' | 'save-as'

export interface SkillImportOptions {
  onConflict?: SkillConflictStrategy
}

export interface SkillFileNode {
  path: string
  size: number
}

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function validateInput(input: LocalSkillInput) {
  if (!SKILL_NAME.test(input.name) || input.name.length > 64) throw new Error('Skill 名称必须使用小写字母、数字和单个连字符')
  if (!input.description.trim() || input.description.length > 1024 || /[\r\n]/.test(input.description)) throw new Error('Skill 描述必须是 1–1024 字符的单行文本')
  if (!input.instructions.trim()) throw new Error('Skill 指令不能为空')
}

function parseSkill(filePath: string, enabled: boolean): LocalSkillRecord | null {
  try {
    return parseSkillContent(readFileSync(filePath, 'utf8'), filePath, enabled)
  } catch {
    return null
  }
}

/** YAML 允许字段值用引号包裹，取值时要剥掉，否则 name 会带上字面引号而通不过校验。 */
function scalar(frontmatter: string, key: string) {
  const raw = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim()
  const quoted = raw?.match(/^"(.*)"$/) ?? raw?.match(/^'(.*)'$/)
  return (quoted ? quoted[1] : raw)?.trim()
}

function parseSkillContent(content: string, filePath: string, enabled: boolean): LocalSkillRecord | null {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatter) return null
  const name = scalar(frontmatter[1], 'name')
  const description = scalar(frontmatter[1], 'description')
  if (!name || !description || !SKILL_NAME.test(name)) return null
  const version = scalar(frontmatter[1], 'version')
  const author = scalar(frontmatter[1], 'author')
  return { name, description, filePath, enabled, ...(version ? { version } : {}), ...(author ? { author } : {}) }
}

/** 安装/解压是本次唯一的「按外部数据写文件」路径，逐条拒绝绝对路径、盘符与 .. 段。 */
export function assertSafeSkillPath(input: string) {
  const normalized = input.replace(/\\/g, '/').trim()
  if (!normalized) throw new Error('Skill 文件路径为空')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) throw new Error(`Skill 文件路径不能是绝对路径：${input}`)
  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) throw new Error(`Skill 文件路径含非法片段：${input}`)
  return normalized
}

function resolveInside(baseDir: string, relative: string) {
  const root = resolve(baseDir)
  const target = resolve(root, assertSafeSkillPath(relative))
  if (target !== root && !target.startsWith(root + sep)) throw new Error(`Skill 文件路径越界：${relative}`)
  return target
}

/** save-as 会换目录名，frontmatter 的 name 必须跟着换，否则启用状态（按目录名存）与记录名对不上。 */
function rewriteSkillName(content: string, name: string) {
  return content.replace(/^(---\r?\n[\s\S]*?)^name:\s*.+$/m, `$1name: ${name}`)
}

function listFilesRecursively(root: string, current = root): SkillFileNode[] {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const full = join(current, entry.name)
    if (entry.isDirectory()) return listFilesRecursively(root, full)
    if (!entry.isFile()) return []
    return [{ path: relativePath(root, full).replace(/\\/g, '/'), size: statSync(full).size }]
  })
}

export class LocalSkillRegistry {
  constructor(private readonly skillsDir: string, private readonly state: SkillStateStore) {
    mkdirSync(skillsDir, { recursive: true })
  }

  list(): LocalSkillRecord[] {
    return readdirSync(this.skillsDir, { withFileTypes: true })
      // 安装中的 .staging-* 临时目录不参与列举。
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => join(this.skillsDir, entry.name, 'SKILL.md'))
      .filter(existsSync)
      .map((filePath) => parseSkill(filePath, this.state.isSkillEnabled(filePath.split(/[\\/]/).at(-2) || '')))
      .filter((record): record is LocalSkillRecord => record !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  create(input: LocalSkillInput): LocalSkillRecord {
    validateInput(input)
    const directory = join(this.skillsDir, input.name)
    if (existsSync(directory)) throw new Error(`Skill 已存在：${input.name}`)
    mkdirSync(directory, { recursive: false })
    this.writeSkill(join(directory, 'SKILL.md'), input)
    this.state.setSkillEnabled(input.name, false)
    return this.require(input.name)
  }

  update(name: string, patch: Partial<Pick<LocalSkillInput, 'description' | 'instructions'>>): LocalSkillRecord {
    const current = this.require(name)
    const source = readFileSync(current.filePath, 'utf8')
    const instructions = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    const next = { name, description: patch.description ?? current.description, instructions: patch.instructions ?? instructions }
    validateInput(next)
    this.writeSkill(current.filePath, next)
    return this.require(name)
  }

  setEnabled(name: string, enabled: boolean) {
    this.require(name)
    this.state.setSkillEnabled(name, enabled)
    return this.require(name)
  }

  /** 返回 Skill 的完整内容（指令文本），供编辑抽屉回填。 */
  read(name: string): { name: string; description: string; filePath: string; enabled: boolean; instructions: string } {
    const record = this.require(name)
    const source = readFileSync(record.filePath, 'utf8')
    const instructions = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
    return { ...record, instructions }
  }

  /** 从本地 SKILL.md 文件、目录或 ZIP 导入 Skill，复制到受管目录并保持停用。 */
  importFromPath(source: string, options: SkillImportOptions = {}): LocalSkillRecord {
    if (/\.zip$/i.test(source) && statSync(source).isFile()) return this.importFromZip(source, options)
    const skillDir = statSync(source).isDirectory() ? source : dirname(source)
    const filePath = join(skillDir, 'SKILL.md')
    if (!existsSync(filePath)) throw new Error('导入目标不是有效的 Skill：缺少 SKILL.md')
    const record = parseSkill(filePath, false)
    if (!record) throw new Error('导入目标不是有效的 Skill：SKILL.md 缺少 name 或 description 前言')
    const files: Record<string, string> = {}
    for (const node of listFilesRecursively(skillDir)) {
      files[node.path] = readFileSync(join(skillDir, node.path), 'utf8')
    }
    return this.installFiles(files, options)
  }

  /** ZIP 里可能带一层顶层目录，以最浅的 SKILL.md 所在目录为基准展开。 */
  importFromZip(zipPath: string, options: SkillImportOptions = {}): LocalSkillRecord {
    const entries = unzipSync(new Uint8Array(readFileSync(zipPath)))
    const names = Object.keys(entries).filter((name) => !name.endsWith('/'))
    const manifest = names
      .filter((name) => name.replace(/\\/g, '/').split('/').at(-1) === 'SKILL.md')
      .sort((a, b) => a.split('/').length - b.split('/').length)[0]
    if (!manifest) throw new Error('ZIP 不是有效的 Skill：缺少 SKILL.md')
    const prefix = manifest.replace(/\\/g, '/').slice(0, -'SKILL.md'.length)
    const decoder = new TextDecoder('utf8')
    const files: Record<string, string> = {}
    for (const name of names) {
      const normalized = name.replace(/\\/g, '/')
      if (!normalized.startsWith(prefix)) continue
      files[assertSafeSkillPath(normalized.slice(prefix.length))] = decoder.decode(entries[name])
    }
    return this.installFiles(files, options)
  }

  /**
   * 把「相对路径 -> 文本内容」整体落盘。先写临时目录再整体 rename，
   * 中途失败不会在 skills 目录留半成品。
   */
  installFiles(files: Record<string, string>, options: SkillImportOptions = {}): LocalSkillRecord {
    const manifest = files['SKILL.md']
    if (typeof manifest !== 'string') throw new Error('Skill 安装载荷缺少 SKILL.md')
    const parsed = parseSkillContent(manifest, 'SKILL.md', false)
    if (!parsed) throw new Error('Skill 安装载荷无效：SKILL.md 缺少 name 或 description 前言')
    const conflict = existsSync(join(this.skillsDir, parsed.name))
    if (conflict && !options.onConflict) throw new Error(`Skill 已存在：${parsed.name}`)
    const name = conflict && options.onConflict === 'save-as' ? this.nextAvailableName(parsed.name) : parsed.name
    const payload = name === parsed.name ? files : { ...files, 'SKILL.md': rewriteSkillName(manifest, name) }
    const staging = join(this.skillsDir, `.staging-${randomUUID()}`)
    const directory = join(this.skillsDir, name)
    try {
      for (const [relative, content] of Object.entries(payload)) {
        const target = resolveInside(staging, relative)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content, 'utf8')
      }
      if (existsSync(directory)) rmSync(directory, { recursive: true, force: true })
      renameSync(staging, directory)
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
    this.state.setSkillEnabled(name, false)
    return this.require(name)
  }

  /** 列出 Skill 目录下的文件树，供详情面板展示。 */
  files(name: string): SkillFileNode[] {
    return listFilesRecursively(this.directoryOf(name))
  }

  directoryOf(name: string) {
    return join(this.require(name).filePath, '..')
  }

  /** Skill 目录的创建时间，用于 meta 表回填 installed_at。 */
  installedAt(name: string) {
    const stats = statSync(this.directoryOf(name))
    return new Date(Math.min(stats.birthtimeMs || stats.mtimeMs, stats.mtimeMs)).toISOString()
  }

  private nextAvailableName(base: string) {
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`
      if (!existsSync(join(this.skillsDir, candidate))) return candidate
    }
    throw new Error(`无法为 ${base} 生成可用的 Skill 名称`)
  }

  enabledSkillPaths() {
    return this.list().filter((skill) => skill.enabled).map((skill) => skill.filePath)
  }

  remove(name: string) {
    const current = this.require(name)
    rmSync(join(current.filePath, '..'), { recursive: true, force: true })
    this.state.removeSkillState(name)
  }

  private require(name: string) {
    const record = this.list().find((skill) => skill.name === name)
    if (!record) throw new Error(`Skill 不存在：${name}`)
    return record
  }

  private writeSkill(filePath: string, input: LocalSkillInput) {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporaryPath, `---\nname: ${input.name}\ndescription: ${input.description.trim()}\n---\n\n${input.instructions.trim()}\n`, 'utf8')
      renameSync(temporaryPath, filePath)
    } finally {
      rmSync(temporaryPath, { force: true })
    }
  }
}
