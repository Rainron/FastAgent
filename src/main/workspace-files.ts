import { readFile, readdir, realpath, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

/** 单次读取上限，避免渲染进程被一个大文件卡死。 */
export const MAX_WORKSPACE_FILE_BYTES = 2 * 1024 * 1024

/** 单次列目录上限，避免一个巨型目录把 IPC 和列表撑爆。 */
export const MAX_WORKSPACE_ENTRIES = 500

/** 这些目录只会把列表淹掉，默认不展示。 */
const IGNORED_DIRECTORIES = new Set(['.git', '.svn', '.hg', 'node_modules', 'dist', 'out', 'build', 'release', 'coverage', '.next', '.turbo', '.venv', 'venv', '__pycache__'])

export interface WorkspaceFileContent {
  path: string
  absolutePath: string
  content: string
  lineCount: number
  truncated: boolean
}

export interface WorkspaceEntry {
  name: string
  /** 相对工作区根目录，统一用 / 分隔，方便直接传回 workspace:read-file。 */
  path: string
  kind: 'dir' | 'file'
  /** 文件字节数；目录恒缺省。与 shared/types 的 WorkspaceEntry 保持一致。 */
  size?: number
  fileType?: string
}

export interface WorkspaceListing {
  path: string
  entries: WorkspaceEntry[]
  truncated: boolean
  /** 目录已不存在；与 shared/types 的 WorkspaceListing 保持一致。 */
  missing?: boolean
}

/** target 是否在 root 之内（含 root 自身）。Windows 下 path.relative 已按大小写不敏感比较。 */
export function containsPath(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  if (rel === '') return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/** 统一成 `a/b` 形式：去掉反斜杠、首尾斜杠和空段，根目录为空串。 */
export function normalizeWorkspaceRelative(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter((segment) => segment !== '' && segment !== '.').join('/')
}

function resolveInside(root: string | null, requested: string): string {
  if (!root) throw new Error('尚未打开工作区')
  if (requested.includes('\0')) throw new Error('文件路径无效')
  if (isAbsolute(requested) || /^[A-Za-z]:[\\/]/.test(requested)) throw new Error('只能打开工作区内的文件')
  const absolute = resolve(root, requested)
  if (!containsPath(root, absolute)) throw new Error('只能打开工作区内的文件')
  return absolute
}

/**
 * 把渲染进程给的相对路径解析成绝对路径，越界一律抛错。
 * 这里只做字符串层面的判断；符号链接逃逸由 readWorkspaceFile 用 realpath 再查一次。
 */
export function resolveWorkspaceFile(root: string | null, requested: string): string {
  if (!root) throw new Error('尚未打开工作区')
  if (!requested) throw new Error('文件路径无效')
  // 归一化会吃掉开头的斜杠，绝对路径必须在这之前拦下，否则 /etc/passwd 会变成工作区内的相对路径。
  if (isAbsolute(requested) || /^[A-Za-z]:[\\/]/.test(requested)) throw new Error('只能打开工作区内的文件')
  // 回答里的路径写法不统一（`src\a.ts`、`./src/a.ts`），先归一成和目录列表一致的形式。
  const normalized = normalizeWorkspaceRelative(requested)
  if (!normalized) throw new Error('文件路径无效')
  return resolveInside(root, normalized)
}

/** 与 resolveWorkspaceFile 同一套越界规则，区别只是允许空路径表示根目录。 */
export function resolveWorkspaceDirectory(root: string | null, requested: string): string {
  return resolveInside(root, requested)
}

/** 找不到同名文件时递归找候选，避免用户被 AI 输出的省略路径卡住。深度和节点都限好，避免巨型仓库拖垮 UI。 */
const MAX_SUGGEST_DEPTH = 5
const MAX_SUGGEST_VISITS = 2000
const MAX_SUGGESTIONS = 3

/**
 * 在 root 下递归找名为 `baseName` 的文件，返回相对 root 的路径数组。
 * 只看文件名匹配（不区分大小写），大小写在 Windows 上无意义。深度超过 MAX_SUGGEST_DEPTH 或访问节点超过 MAX_SUGGEST_VISITS 就停。
 */
export async function findSameName(root: string, baseName: string): Promise<string[]> {
  const realRoot = await realpath(root)
  const matches: string[] = []
  const queue: { path: string; depth: number }[] = [{ path: '', depth: 0 }]
  let visits = 0
  const target = baseName.toLowerCase()
  while (queue.length > 0 && visits < MAX_SUGGEST_VISITS) {
    const { path: current, depth } = queue.shift() as { path: string; depth: number }
    let dirents
    try {
      dirents = await readdir(resolve(realRoot, current), { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      visits += 1
      if (dirent.name.startsWith('.')) continue
      const relative = current ? `${current}/${dirent.name}` : dirent.name
      if (dirent.isDirectory()) {
        if (depth < MAX_SUGGEST_DEPTH && !IGNORED_DIRECTORIES.has(dirent.name)) queue.push({ path: relative, depth: depth + 1 })
        continue
      }
      if (!dirent.isFile()) continue
      if (dirent.name.toLowerCase() === target) matches.push(relative)
    }
  }
  matches.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
  return matches.slice(0, MAX_SUGGESTIONS)
}

/** fs 的 ENOENT/EACCES 原样抛到渲染层会变成一长串英文，这里换成能看懂的说法。 */
function toFriendlyError(error: unknown, target: string, root?: string | null, suggestions: string[] = []): Error {
  const code = (error as NodeJS.ErrnoException | null)?.code
  const label = target || '工作区根目录'
  if (code === 'ENOENT') {
    const base = root ? `文件或目录不存在：${label}（当前工作区：${root}）` : `文件或目录不存在：${label}`
    if (suggestions.length === 0) return new Error(base)
    const list = suggestions.join('、')
    return new Error(`${base}\n\n你是不是要找：${list}`)
  }
  if (code === 'EACCES' || code === 'EPERM') return new Error(`没有访问权限：${label}`)
  if (code === 'EISDIR') return new Error(`目标是目录，不能预览：${label}`)
  if (code === 'ENOTDIR') return new Error(`路径中有一段不是目录：${label}`)
  if (code === 'EMFILE' || code === 'ENFILE') return new Error('系统打开的文件过多，稍后再试')
  return error instanceof Error ? error : new Error(`读取失败：${label}`)
}

function isProbablyBinary(buffer: Buffer): boolean {
  // 只看开头一段：出现 NUL 基本可以判定不是文本。
  return buffer.subarray(0, 4096).includes(0)
}

async function readResolvedFile(root: string, absolute: string): Promise<Omit<WorkspaceFileContent, 'path'>> {
  // 符号链接可能指到工作区外，按真实路径再判一次。
  const realRoot = await realpath(root)
  const realTarget = await realpath(absolute)
  if (!containsPath(realRoot, realTarget)) throw new Error('只能打开工作区内的文件')
  const info = await stat(realTarget)
  if (!info.isFile()) throw new Error('目标不是文件')
  const buffer = await readFile(realTarget)
  if (isProbablyBinary(buffer)) throw new Error('不支持预览二进制文件')
  const truncated = buffer.byteLength > MAX_WORKSPACE_FILE_BYTES
  const content = buffer.subarray(0, MAX_WORKSPACE_FILE_BYTES).toString('utf8')
  return { absolutePath: realTarget, content, lineCount: content.split('\n').length, truncated }
}

export async function readWorkspaceFile(root: string | null, requested: string): Promise<WorkspaceFileContent> {
  const absolute = resolveWorkspaceFile(root, requested)
  try {
    const result = await readResolvedFile(root as string, absolute)
    return { path: requested, ...result }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code !== 'ENOENT' || !root) throw toFriendlyError(error, requested, root)
    // 回答里常出现省略目录的裸文件名，直接报错会阻断预览；同名候选唯一时自动回退，多个时取最浅层的一个。
    const basename = normalizeWorkspaceRelative(requested).split('/').pop() || requested
    const candidates = await findSameName(root, basename)
    for (const candidate of candidates) {
      try {
        const result = await readResolvedFile(root, resolve(root, candidate))
        return { path: candidate, ...result }
      } catch {
        // 单个候选读不了（权限/二进制）就试下一个，都不行再落到下面的报错。
      }
    }
    throw toFriendlyError(error, requested, root, candidates)
  }
}

export async function listWorkspaceDirectory(root: string | null, requested: string): Promise<WorkspaceListing> {
  const relativePath = normalizeWorkspaceRelative(requested)
  const absolute = resolveWorkspaceDirectory(root, relativePath)
  try {
    const realRoot = await realpath(root as string)
    const realTarget = await realpath(absolute)
    if (!containsPath(realRoot, realTarget)) throw new Error('只能打开工作区内的文件')
    const dirents = await readdir(realTarget, { withFileTypes: true })
    const entries: WorkspaceEntry[] = []
    for (const dirent of dirents) {
      // 符号链接指向哪里不好说，列表里先不给，避免点开才发现越界。
      const isDir = dirent.isDirectory()
      if (!isDir && !dirent.isFile()) continue
      if (isDir && IGNORED_DIRECTORIES.has(dirent.name)) continue
      const entry: WorkspaceEntry = {
        name: dirent.name,
        path: relativePath ? `${relativePath}/${dirent.name}` : dirent.name,
        kind: isDir ? 'dir' : 'file'
      }
      if (!isDir) {
        const dot = dirent.name.lastIndexOf('.')
        if (dot > 0 && dot < dirent.name.length - 1) entry.fileType = dirent.name.slice(dot + 1).toLowerCase()
        try {
          entry.size = (await stat(join(realTarget, dirent.name))).size
        } catch {
          // 单个文件 stat 失败（权限/占用）不阻断整个目录列表。
        }
      }
      entries.push(entry)
    }
    entries.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1)
    return { path: relativePath, entries: entries.slice(0, MAX_WORKSPACE_ENTRIES), truncated: entries.length > MAX_WORKSPACE_ENTRIES }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    // 目录没了是常态：展开态是持久化的，外部删目录 / 切分支后恢复展开就会打到空处。
    // 这不是异常——抛出去只会在主进程刷一屏 Electron 报错，还要为每个失效目录跑一次
    // 全工作区的同名候选扫描。返回 missing 让调用方把展开态收敛掉。
    if (code === 'ENOENT') return { path: relativePath, entries: [], truncated: false, missing: true }
    throw toFriendlyError(error, relativePath, root)
  }
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml'
}

/** 单张图片预览上限：超过按 10MB 拦截，避免 base64 撑爆 IPC。 */
const MAX_IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024

export interface WorkspaceImageContent {
  path: string
  dataUrl: string
}

/**
 * 读取工作区内的图片并转 base64 data URL，供预览面板直接展示。
 * 越界规则与 readWorkspaceFile 一致；非图片扩展名与超大文件直接抛错。
 */
export async function readWorkspaceImage(root: string | null, requested: string): Promise<WorkspaceImageContent> {
  const extension = requested.split('.').pop()?.toLowerCase() ?? ''
  const mime = IMAGE_EXTENSIONS[extension]
  if (!mime) throw new Error('不是可预览的图片格式')
  const absolute = resolveWorkspaceFile(root, requested)
  const realRoot = await realpath(root as string)
  const realTarget = await realpath(absolute)
  if (!containsPath(realRoot, realTarget)) throw new Error('只能打开工作区内的文件')
  const info = await stat(realTarget)
  if (!info.isFile()) throw new Error('目标不是文件')
  if (info.size > MAX_IMAGE_PREVIEW_BYTES) throw new Error('图片过大，仅支持预览 10MB 以内的图片')
  const buffer = await readFile(realTarget)
  return { path: requested, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` }
}

export interface WorkspaceDeleteResult {
  ok: boolean
  error?: string
}

/**
 * 删除工作区内的文件或目录（目录递归）。越界 / 符号链接逃逸 / 不存在都返回错误，不抛异常。
 * 只做路径与权限校验，删除行为由用户右键菜单显式触发，不经过 agent 工具权限引擎。
 */
export async function deleteWorkspaceEntry(root: string | null, requested: string): Promise<WorkspaceDeleteResult> {
  if (!root) return { ok: false, error: '尚未打开工作区' }
  let absolute: string
  try {
    absolute = resolveWorkspaceFile(root, requested)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '路径无效' }
  }
  try {
    // 符号链接可能指到工作区外，按真实路径再判一次，避免删到外部目标。
    const realRoot = await realpath(root)
    const realTarget = await realpath(absolute)
    if (!containsPath(realRoot, realTarget)) return { ok: false, error: '只能删除工作区内的文件' }
    await rm(realTarget, { recursive: true, force: false })
    return { ok: true }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === 'ENOENT') return { ok: false, error: `文件或目录不存在：${requested}` }
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, error: `没有删除权限：${requested}` }
    return { ok: false, error: error instanceof Error ? error.message : '删除失败' }
  }
}

export interface WorkspaceFileMatch {
  name: string
  /** 相对工作区根目录，`/` 分隔 */
  path: string
  absolutePath: string
  size: number
  /** 目录候选：与 shared/types 的定义保持一致 */
  isDirectory?: boolean
}

/** 遍历上限：@ 补全要的是「够用且不卡」，不是完整索引，超过就停。 */
const MAX_SEARCH_VISITS = 20000
/** 子序列匹配：输入 `apptsx` 也能命中 `src/App.tsx`，与编辑器的模糊跳转一致。 */
export function matchesFuzzy(candidate: string, query: string): boolean {
  if (!query) return true
  const haystack = candidate.toLowerCase()
  let index = 0
  for (const char of query.toLowerCase()) {
    const found = haystack.indexOf(char, index)
    if (found < 0) return false
    index = found + 1
  }
  return true
}

/** 浅层、短路径优先：@ 补全里 `src/App.tsx` 几乎总比深层同名文件更可能是目标。 */
function compareMatches(a: string, b: string): number {
  const depth = a.split('/').length - b.split('/').length
  return depth !== 0 ? depth : a.length - b.length || a.localeCompare(b)
}

/**
 * 输入框 @ 补全的文件搜索：按目录逐层广度遍历，命中即收，够数或到上限就停。
 * 复用 listWorkspaceDirectory 的忽略目录名单，并额外跳过所有点开头的条目
 * （.env 这类不该出现在补全里）。
 */
export async function searchWorkspaceFiles(root: string | null, query: string, limit = 30): Promise<WorkspaceFileMatch[]> {
  if (!root) throw new Error('尚未打开工作区')
  const realRoot = await realpath(root)
  const keyword = query.trim()
  const found: string[] = []
  const directories = new Set<string>()
  const queue: string[] = ['']
  let visits = 0

  while (queue.length > 0 && found.length < limit && visits < MAX_SEARCH_VISITS) {
    const current = queue.shift() as string
    let dirents
    try {
      dirents = await readdir(resolve(realRoot, current), { withFileTypes: true })
    } catch {
      // 单个目录没权限不该让整次搜索失败。
      continue
    }
    for (const dirent of dirents) {
      if (visits >= MAX_SEARCH_VISITS || found.length >= limit) break
      visits += 1
      if (dirent.name.startsWith('.')) continue
      const relativePath = current ? `${current}/${dirent.name}` : dirent.name
      if (dirent.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(dirent.name)) {
          queue.push(relativePath)
          // 目录本身也作为 @ 候选：命中关键字时与文件一起收集，size 无意义置 0。
          if (matchesFuzzy(relativePath, keyword)) {
            directories.add(relativePath)
            found.push(relativePath)
          }
        }
        continue
      }
      if (!dirent.isFile() || !matchesFuzzy(relativePath, keyword)) continue
      found.push(relativePath)
    }
  }

  found.sort(compareMatches)
  return Promise.all(found.map(async (path) => {
    const isDirectory = directories.has(path)
    const absolutePath = resolve(realRoot, path)
    let size = 0
    if (!isDirectory) {
      try { size = (await stat(absolutePath)).size } catch { size = 0 }
    }
    return { name: path.split('/').at(-1) as string, path, absolutePath, size, isDirectory }
  }))
}
