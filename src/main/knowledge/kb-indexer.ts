import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, existsSync, type Dirent } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import type { KbIndexResult, KbSource, KbSourceKind, KbSourcePreview } from '../../shared/types'
import type { KbChunkInput, KbStore } from '../kb-store'
import { chunkContent, chunkPlainText, chunkTitle, lineLocator, pageLocator } from './chunk-text'
import { DEFAULT_EXCLUDES, MAX_SOURCE_FILES, selectSourceFiles, summarizeSkipped, type ScanEntry } from './source-scan'

/** 遍历上限：目录再深也不该把整棵树读进内存，超了就停在这一层。 */
const MAX_SCAN_ENTRIES = 20_000

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 列出目录下所有文件（相对路径 + 大小）。排除规则在筛选阶段生效，这里只负责遍历。 */
export function listDirectoryEntries(root: string, limit = MAX_SCAN_ENTRIES): ScanEntry[] {
  const entries: ScanEntry[] = []
  const stack: string[] = [root]
  while (stack.length && entries.length < limit) {
    const current = stack.pop() as string
    let children: Dirent[]
    try { children = readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const child of children) {
      const full = join(current, child.name)
      if (child.isDirectory()) {
        // 大目录的排除在这里就生效，否则 node_modules 会把遍历预算吃光。
        if (DEFAULT_EXCLUDES.includes(child.name)) continue
        stack.push(full)
        continue
      }
      if (!child.isFile()) continue
      let size = 0
      try { size = statSync(full).size } catch { continue }
      entries.push({ path: relative(root, full).split(sep).join('/'), size })
      if (entries.length >= limit) break
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

function scanEntriesFor(path: string, kind: KbSourceKind): ScanEntry[] {
  if (kind === 'file') {
    const size = statSync(path).size
    return [{ path: basename(path), size }]
  }
  return listDirectoryEntries(path)
}

/** 导入前的范围预览：让用户先看清会索引什么、什么被跳过了。 */
export function previewSource(path: string, kind: KbSourceKind, excludes: readonly string[] = DEFAULT_EXCLUDES): KbSourcePreview {
  const result = selectSourceFiles(scanEntriesFor(path, kind), { excludes, maxFiles: MAX_SOURCE_FILES })
  return {
    path,
    kind,
    files: result.candidates.map((candidate) => ({ path: candidate.path, size: candidate.size, kind: candidate.kind })),
    skipped: summarizeSkipped(result.skipped),
    truncated: result.truncated
  }
}

export interface IndexDependencies {
  readText: (absolutePath: string) => string
  readBinary: (absolutePath: string) => Uint8Array
  extractPdfPages: (data: Uint8Array) => Promise<Array<{ page: number; text: string }>>
  now: () => number
}

const defaultDependencies: Omit<IndexDependencies, 'extractPdfPages'> = {
  readText: (path) => readFileSync(path, 'utf8'),
  readBinary: (path) => new Uint8Array(readFileSync(path)),
  now: () => Date.now()
}

/** 把一个文件切成待写入的知识块。PDF 逐页切，文本按结构切。 */
async function chunksForFile(absolutePath: string, relativePath: string, kind: 'markdown' | 'text' | 'pdf', dependencies: IndexDependencies): Promise<{ chunks: KbChunkInput[]; hash: string }> {
  const name = relativePath.split('/').at(-1) ?? relativePath
  if (kind === 'pdf') {
    const data = dependencies.readBinary(absolutePath)
    const hash = createHash('sha256').update(data).digest('hex')
    const pages = await dependencies.extractPdfPages(data)
    if (!pages.length) throw new Error('PDF 没有可提取的文本层（扫描件需要 OCR，暂不支持）')
    // 单页可能很长，页内再按长度切；定位仍然给页码，这是 PDF 唯一可验证的位置。
    const chunks = pages.flatMap((page) => chunkPlainText(page.text).map((chunk) => ({
      title: `${name} · ${pageLocator(page.page)}`,
      content: chunk.text,
      locator: pageLocator(page.page)
    })))
    return { chunks, hash }
  }
  const content = dependencies.readText(absolutePath)
  const hash = hashContent(content)
  const chunks = chunkContent(content, kind).map((chunk) => ({
    title: chunkTitle(name, chunk),
    content: chunk.text,
    locator: lineLocator(chunk)
  }))
  return { chunks, hash }
}

/**
 * 索引 / 重新索引一个来源。
 *
 * 增量：逐文件比对内容哈希，未变的直接跳过；来源里已经不存在的文件删掉它的条目。
 * 单个文件失败不终止整轮——一份读不了的 PDF 不该让整个目录的索引作废。
 */
export async function indexSource(
  store: KbStore,
  namespace: string,
  source: KbSource,
  overrides: Partial<IndexDependencies> = {}
): Promise<KbIndexResult> {
  const dependencies: IndexDependencies = {
    ...defaultDependencies,
    extractPdfPages: async () => { throw new Error('未提供 PDF 解析实现') },
    ...overrides
  }
  if (!existsSync(source.path)) {
    const stale = store.updateSourceStatus(namespace, source.id, { status: 'stale', error: '来源路径已不存在，其条目已停止参与检索' }, dependencies.now())
    return { source: stale, indexedFiles: 0, unchangedFiles: 0, removedFiles: 0, entryCount: stale.entryCount, failures: [] }
  }
  const scan = selectSourceFiles(scanEntriesFor(source.path, source.kind), { excludes: source.excludes, maxFiles: MAX_SOURCE_FILES })
  const known = store.listSourceFileHashes(namespace, source.id)
  const seen = new Set<string>()
  const failures: Array<{ path: string; error: string }> = []
  let indexedFiles = 0
  let unchangedFiles = 0

  for (const candidate of scan.candidates) {
    seen.add(candidate.path)
    // 单文件来源的相对路径就是文件名，绝对路径直接用来源自身。
    const absolutePath = source.kind === 'file' ? source.path : join(source.path, candidate.path)
    try {
      const { chunks, hash } = await chunksForFile(absolutePath, candidate.path, candidate.kind, dependencies)
      if (known.get(candidate.path) === hash) { unchangedFiles += 1; continue }
      store.replaceFileEntries(namespace, {
        projectId: source.projectId,
        sourceId: source.id,
        path: candidate.path,
        contentHash: hash,
        chunks
      }, dependencies.now())
      indexedFiles += 1
    } catch (error) {
      failures.push({ path: candidate.path, error: error instanceof Error ? error.message : String(error) })
    }
  }

  let removedFiles = 0
  for (const path of known.keys()) {
    if (seen.has(path)) continue
    store.removeFileEntries(namespace, source.id, path)
    removedFiles += 1
  }

  // 全部文件都失败才算来源失败；部分失败仍然是 indexed，失败清单单独返回。
  const allFailed = scan.candidates.length > 0 && failures.length === scan.candidates.length
  const error = failures.length ? `${failures.length} 个文件索引失败：${failures[0].error}` : null
  const updated = store.updateSourceStatus(namespace, source.id, {
    status: allFailed ? 'failed' : 'indexed',
    error,
    fileCount: seen.size - failures.length,
    bumpVersion: indexedFiles > 0 || removedFiles > 0
  }, dependencies.now())
  return { source: updated, indexedFiles, unchangedFiles, removedFiles, entryCount: updated.entryCount, failures }
}
