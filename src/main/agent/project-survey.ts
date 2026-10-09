// /init 的项目扫描：先由主进程做一遍确定性的静态勘察，再把结果交给 Agent 去核实与成文。
// 纯分析函数与磁盘遍历分开，前者可测，后者只负责把文件喂进来。

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, posix, sep } from 'node:path'

export interface SurveyFile {
  /** 相对项目根、用 / 分隔的路径 */
  path: string
  content: string
}

export interface ProjectCommand {
  label: string
  command: string
  source: string
}

export interface ProjectSurvey {
  name: string
  /** 目录结构条目，目录以 / 结尾 */
  entries: string[]
  entriesTruncated: boolean
  configFiles: string[]
  stack: string[]
  commands: ProjectCommand[]
  style: string[]
  /** 已存在的 agent 记忆文件名；有则走「补全订正」而不是「新建」 */
  existingAgentFile: string | null
}

/** 遍历时整棵跳过的目录：依赖与产物目录动辄十万文件，进来一次就把预算耗光。 */
const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'release', 'target',
  'vendor', 'coverage', '.next', '.nuxt', '.turbo', '.vite', '.cache', '.idea', '.vscode',
  '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'logs', 'tmp'
])

const MAX_TREE_DEPTH = 3
const MAX_TREE_ENTRIES = 160
const MAX_CONFIG_BYTES = 128 * 1024
const MAX_STYLE_SAMPLES = 12
const MAX_STYLE_BYTES = 40 * 1024

const CONFIG_FILE_PATTERNS: RegExp[] = [
  /^package\.json$/,
  /^tsconfig(\..+)?\.json$/,
  /^pyproject\.toml$/,
  /^requirements[\w.-]*\.txt$/,
  /^setup\.(py|cfg)$/,
  /^Cargo\.toml$/,
  /^go\.mod$/,
  /^pom\.xml$/,
  /^build\.gradle(\.kts)?$/,
  /^composer\.json$/,
  /^Gemfile$/,
  /^(Makefile|makefile|justfile)$/,
  /^Dockerfile$/,
  /^docker-compose\.ya?ml$/,
  /^\.gitignore$/,
  /^\.editorconfig$/,
  /^\.nvmrc$/,
  /^\.python-version$/,
  /^(\.eslintrc[\w.]*|eslint\.config\.[cm]?[jt]s)$/,
  /^\.prettierrc[\w.]*$/,
  /^(vite|vitest|jest|next|nuxt|webpack|rollup|tailwind|playwright|electron\.vite|electron-builder)\.config\.[cm]?[jt]s$/,
  /^README(\.[\w-]+)?$/i
]

const STYLE_SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.go', '.rs', '.java', '.kt', '.cs', '.rb', '.php', '.swift', '.c', '.cc', '.cpp', '.h', '.hpp'
])

/** 项目根已存在的 agent 记忆文件（存在则补全而非覆盖）。 */
export const AGENT_MEMORY_FILE_NAMES = ['AGENTS.md', 'CLAUDE.md'] as const

export function isProjectConfigFile(name: string): boolean {
  return CONFIG_FILE_PATTERNS.some((pattern) => pattern.test(name))
}

export interface SurveyDirEntry {
  name: string
  directory: boolean
}

/**
 * 广度优先遍历项目目录。
 *
 * 用广度而不是深度：预算用完时保住的是靠近根的结构，那才是「项目长什么样」的答案；
 * 深度优先会把额度全花在第一个子树上。
 */
export function walkProjectTree(root: string, readDir: (path: string) => SurveyDirEntry[] = defaultReadDir): { entries: string[]; truncated: boolean } {
  const entries: string[] = []
  let truncated = false
  let queue: Array<{ absolute: string; relative: string; depth: number }> = [{ absolute: root, relative: '', depth: 0 }]
  while (queue.length && !truncated) {
    const next: typeof queue = []
    for (const current of queue) {
      let children: SurveyDirEntry[]
      try {
        children = readDir(current.absolute)
      } catch {
        continue
      }
      for (const child of [...children].sort((a, b) => a.name.localeCompare(b.name))) {
        if (child.name.startsWith('.') && !isProjectConfigFile(child.name)) continue
        if (child.directory && IGNORED_DIRECTORIES.has(child.name)) continue
        if (entries.length >= MAX_TREE_ENTRIES) { truncated = true; break }
        const relativePath = current.relative ? posix.join(current.relative, child.name) : child.name
        entries.push(child.directory ? `${relativePath}/` : relativePath)
        if (child.directory && current.depth + 1 < MAX_TREE_DEPTH) next.push({ absolute: join(current.absolute, child.name), relative: relativePath, depth: current.depth + 1 })
      }
      if (truncated) break
    }
    queue = next
  }
  return { entries, truncated }
}

function defaultReadDir(path: string): SurveyDirEntry[] {
  return readdirSync(path, { withFileTypes: true }).map((entry) => ({ name: entry.name, directory: entry.isDirectory() }))
}

function readTextFile(absolute: string, limit: number): string | null {
  try {
    if (statSync(absolute).size > limit) return null
    return readFileSync(absolute, 'utf8')
  } catch {
    return null
  }
}

function parseJson(content: string | undefined): Record<string, unknown> | null {
  if (!content) return null
  try {
    const value = JSON.parse(content)
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** 依赖名 → 技术栈标签。命中即算，版本由 Agent 后续读 package.json 自己确认。 */
const DEPENDENCY_LABELS: Array<[RegExp, string]> = [
  [/^react$/, 'React'],
  [/^react-dom$/, 'React DOM'],
  [/^vue$/, 'Vue'],
  [/^svelte$/, 'Svelte'],
  [/^@angular\/core$/, 'Angular'],
  [/^next$/, 'Next.js'],
  [/^nuxt$/, 'Nuxt'],
  [/^electron$/, 'Electron'],
  [/^electron-vite$/, 'electron-vite'],
  [/^vite$/, 'Vite'],
  [/^webpack$/, 'webpack'],
  [/^rollup$/, 'Rollup'],
  [/^esbuild$/, 'esbuild'],
  [/^typescript$/, 'TypeScript'],
  [/^vitest$/, 'Vitest'],
  [/^jest$/, 'Jest'],
  [/^mocha$/, 'Mocha'],
  [/^@playwright\/test$/, 'Playwright'],
  [/^cypress$/, 'Cypress'],
  [/^eslint$/, 'ESLint'],
  [/^prettier$/, 'Prettier'],
  [/^tailwindcss$/, 'Tailwind CSS'],
  [/^express$/, 'Express'],
  [/^fastify$/, 'Fastify'],
  [/^@nestjs\/core$/, 'NestJS'],
  [/^prisma$|^@prisma\/client$/, 'Prisma'],
  [/^better-sqlite3$/, 'better-sqlite3'],
  [/^@modelcontextprotocol\/sdk$/, 'MCP SDK']
]

const FILE_STACK_LABELS: Array<[RegExp, string]> = [
  [/^pyproject\.toml$/, 'Python（pyproject）'],
  [/^requirements[\w.-]*\.txt$/, 'Python（requirements）'],
  [/^Cargo\.toml$/, 'Rust / Cargo'],
  [/^go\.mod$/, 'Go Modules'],
  [/^pom\.xml$/, 'Java / Maven'],
  [/^build\.gradle(\.kts)?$/, 'Java / Gradle'],
  [/^composer\.json$/, 'PHP / Composer'],
  [/^Gemfile$/, 'Ruby / Bundler'],
  [/^Dockerfile$/, 'Docker'],
  [/^docker-compose\.ya?ml$/, 'Docker Compose'],
  [/^(Makefile|makefile)$/, 'Make']
]

export function detectTechStack(input: { configFiles: string[]; packageJson?: string; pyproject?: string }): string[] {
  const labels = new Set<string>()
  const pkg = parseJson(input.packageJson)
  if (pkg) {
    labels.add('Node.js / npm 包')
    if (typeof pkg.type === 'string' && pkg.type === 'module') labels.add('ESM 模块')
    const dependencies = { ...(pkg.dependencies as object ?? {}), ...(pkg.devDependencies as object ?? {}) }
    for (const name of Object.keys(dependencies)) {
      for (const [pattern, label] of DEPENDENCY_LABELS) if (pattern.test(name)) labels.add(label)
    }
  }
  for (const path of input.configFiles) {
    const name = posix.basename(path)
    for (const [pattern, label] of FILE_STACK_LABELS) if (pattern.test(name)) labels.add(label)
  }
  if (input.pyproject) {
    if (/\[tool\.poetry\]/.test(input.pyproject)) labels.add('Poetry')
    if (/\[tool\.uv\]|^\s*uv\b/m.test(input.pyproject)) labels.add('uv')
    if (/\[tool\.ruff\]/.test(input.pyproject)) labels.add('Ruff')
    if (/\[tool\.pytest/.test(input.pyproject)) labels.add('pytest')
  }
  return [...labels]
}

/** Makefile 目标：忽略以 . 开头的特殊目标与变量赋值行。 */
export function extractMakefileTargets(content: string): string[] {
  const targets: string[] = []
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9][\w.-]*)\s*:(?!=)/.exec(line)
    if (match && !targets.includes(match[1])) targets.push(match[1])
  }
  return targets
}

export function extractProjectCommands(input: { configFiles: string[]; packageJson?: string; makefile?: string; pyproject?: string }): ProjectCommand[] {
  const commands: ProjectCommand[] = []
  const pkg = parseJson(input.packageJson)
  const scripts = pkg?.scripts
  if (scripts && typeof scripts === 'object') {
    for (const [name, value] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      commands.push({ label: name, command: `npm run ${name}`, source: `package.json scripts.${name} → ${value}` })
    }
  }
  if (input.makefile) {
    for (const target of extractMakefileTargets(input.makefile)) {
      commands.push({ label: target, command: `make ${target}`, source: 'Makefile' })
    }
  }
  const names = input.configFiles.map((path) => posix.basename(path))
  if (names.includes('Cargo.toml')) {
    commands.push({ label: 'build', command: 'cargo build', source: 'Cargo.toml' }, { label: 'test', command: 'cargo test', source: 'Cargo.toml' })
  }
  if (names.includes('go.mod')) {
    commands.push({ label: 'build', command: 'go build ./...', source: 'go.mod' }, { label: 'test', command: 'go test ./...', source: 'go.mod' })
  }
  if (input.pyproject) {
    if (/\[tool\.pytest/.test(input.pyproject)) commands.push({ label: 'test', command: 'pytest', source: 'pyproject.toml [tool.pytest]' })
    if (/\[tool\.ruff\]/.test(input.pyproject)) commands.push({ label: 'lint', command: 'ruff check .', source: 'pyproject.toml [tool.ruff]' })
  }
  return commands
}

function dominant<T extends string>(counts: Map<T, number>): { value: T; ratio: number } | null {
  let total = 0
  let best: { value: T; count: number } | null = null
  for (const [value, count] of counts) {
    total += count
    if (!best || count > best.count) best = { value, count }
  }
  if (!best || total === 0) return null
  return { value: best.value, ratio: best.count / total }
}

/**
 * 代码风格采样。
 *
 * 只给「多数派」结论并附占比：样本是抽的，说死了会把个别文件的写法当成全项目约定，
 * Agent 拿去写进 AGENTS.md 就成了错误规范。
 */
export function analyzeCodeStyle(samples: SurveyFile[]): string[] {
  if (!samples.length) return []
  const indents = new Map<string, number>()
  const quotes = new Map<string, number>()
  const fileNaming = new Map<string, number>()
  let semicolonLines = 0
  let statementLines = 0
  let esmImports = 0
  let requireCalls = 0
  let longLines = 0
  let totalLines = 0
  for (const sample of samples) {
    const name = basename(sample.path, extname(sample.path))
    if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(name)) fileNaming.set('kebab-case', (fileNaming.get('kebab-case') ?? 0) + 1)
    else if (/^[a-z][a-zA-Z0-9]*$/.test(name)) fileNaming.set('camelCase', (fileNaming.get('camelCase') ?? 0) + 1)
    else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) fileNaming.set('PascalCase', (fileNaming.get('PascalCase') ?? 0) + 1)
    else if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(name)) fileNaming.set('snake_case', (fileNaming.get('snake_case') ?? 0) + 1)
    for (const line of sample.content.split(/\r?\n/)) {
      totalLines += 1
      if (line.length > 120) longLines += 1
      const indent = /^(\t+|[ ]+)(?=\S)/.exec(line)
      if (indent) {
        if (indent[1].startsWith('\t')) indents.set('tab', (indents.get('tab') ?? 0) + 1)
        else if (indent[1].length % 4 === 0) indents.set('4 空格', (indents.get('4 空格') ?? 0) + 1)
        else if (indent[1].length % 2 === 0) indents.set('2 空格', (indents.get('2 空格') ?? 0) + 1)
      }
      const code = line.trim()
      if (!code || code.startsWith('//') || code.startsWith('*') || code.startsWith('#')) continue
      if (/^import\s|^export\s+(\*|\{|default)/.test(code)) esmImports += 1
      if (/\brequire\(/.test(code)) requireCalls += 1
      const singles = (code.match(/'/g) ?? []).length
      const doubles = (code.match(/"/g) ?? []).length
      if (singles > doubles) quotes.set('单引号', (quotes.get('单引号') ?? 0) + 1)
      else if (doubles > singles) quotes.set('双引号', (quotes.get('双引号') ?? 0) + 1)
      if (/[\w)\]'"`]$/.test(code) || code.endsWith(';')) {
        statementLines += 1
        if (code.endsWith(';')) semicolonLines += 1
      }
    }
  }
  const notes: string[] = []
  const indent = dominant(indents)
  if (indent) notes.push(`缩进主要是 ${indent.value}（占比 ${percent(indent.ratio)}）`)
  const quote = dominant(quotes)
  if (quote) notes.push(`字符串以${quote.value}为主（占比 ${percent(quote.ratio)}）`)
  if (statementLines >= 20) {
    const ratio = semicolonLines / statementLines
    notes.push(ratio >= 0.6 ? `语句结尾普遍带分号（占比 ${percent(ratio)}）` : `语句结尾普遍不带分号（带分号仅 ${percent(ratio)}）`)
  }
  if (esmImports + requireCalls >= 5) {
    notes.push(esmImports >= requireCalls ? `模块以 ESM import/export 为主（${esmImports} 处 import，${requireCalls} 处 require）` : `模块以 CommonJS require 为主（${requireCalls} 处 require，${esmImports} 处 import）`)
  }
  const naming = dominant(fileNaming)
  if (naming) notes.push(`源文件名主要是 ${naming.value}（占比 ${percent(naming.ratio)}，样本 ${samples.length} 个文件）`)
  if (totalLines >= 200) notes.push(`超过 120 字符的长行占 ${percent(longLines / totalLines)}`)
  return notes
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** 已存在的 agent 记忆文件名；没有则返回 null。优先认 AGENTS.md。 */
export function detectExistingAgentFile(entries: string[]): string | null {
  const rootFiles = new Set(entries.filter((entry) => !entry.includes('/')))
  for (const name of AGENT_MEMORY_FILE_NAMES) {
    if (rootFiles.has(name)) return name
  }
  return null
}

/** 挑选风格采样文件：优先项目内的源码目录，跳过测试与声明文件。 */
export function pickStyleSampleFiles(entries: string[], limit = MAX_STYLE_SAMPLES): string[] {
  return entries
    .filter((entry) => !entry.endsWith('/'))
    .filter((entry) => STYLE_SOURCE_EXTENSIONS.has(extname(entry)))
    .filter((entry) => !/\.(test|spec)\.[\w]+$/.test(entry) && !entry.endsWith('.d.ts'))
    .slice(0, limit)
}

/** 磁盘勘察入口：遍历目录、读关键配置、采样源码，产出交给 Agent 的事实清单。 */
export function collectProjectSurvey(root: string): ProjectSurvey {
  const { entries, truncated } = walkProjectTree(root)
  const configFiles = entries.filter((entry) => !entry.endsWith('/') && isProjectConfigFile(posix.basename(entry)))
  const readConfig = (name: string): string | undefined => {
    const match = configFiles.find((entry) => posix.basename(entry) === name && !entry.includes('/'))
    return match ? readTextFile(join(root, ...match.split('/')), MAX_CONFIG_BYTES) ?? undefined : undefined
  }
  const packageJson = readConfig('package.json')
  const pyproject = readConfig('pyproject.toml')
  const makefile = readConfig('Makefile') ?? readConfig('makefile')
  const samples = pickStyleSampleFiles(entries).flatMap((path) => {
    const content = readTextFile(join(root, ...path.split('/')), MAX_STYLE_BYTES)
    return content === null ? [] : [{ path, content }]
  })
  return {
    name: basename(root.replace(new RegExp(`${sep === '\\' ? '\\\\' : sep}+$`), '')) || root,
    entries,
    entriesTruncated: truncated,
    configFiles,
    stack: detectTechStack({ configFiles, packageJson, pyproject }),
    commands: extractProjectCommands({ configFiles, packageJson, makefile, pyproject }),
    style: analyzeCodeStyle(samples),
    existingAgentFile: detectExistingAgentFile(entries)
  }
}
