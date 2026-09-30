import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { KB_SCHEMA_SQL, KbStore } from '../kb-store'
import { indexSource, listDirectoryEntries, previewSource } from './kb-indexer'
import { buildMemoryQueryPlan } from '../agent/memory/memory-query'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true })
})

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-kb-'))
  roots.push(root)
  return root
}

function makeStore() {
  const db = new Database(':memory:')
  db.exec(KB_SCHEMA_SQL)
  return new KbStore(db)
}

function createSource(store: KbStore, path: string, kind: 'file' | 'directory' = 'directory') {
  return store.createSource('acct', { projectId: 'p1', kind, path, title: '文档', excludes: ['node_modules'] })
}

describe('listDirectoryEntries', () => {
  it('递归列出文件并跳过默认排除目录', () => {
    const root = makeRoot()
    mkdirSync(join(root, 'docs'))
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'docs', 'a.md'), '# A')
    writeFileSync(join(root, 'node_modules', 'b.md'), '# B')
    expect(listDirectoryEntries(root).map((entry) => entry.path)).toEqual(['docs/a.md'])
  })
})

describe('previewSource', () => {
  it('给出候选文件与跳过原因，不写库', () => {
    const root = makeRoot()
    writeFileSync(join(root, 'a.md'), '# A')
    writeFileSync(join(root, 'logo.png'), 'binary')
    const preview = previewSource(root, 'directory')
    expect(preview.files.map((file) => file.path)).toEqual(['a.md'])
    expect(preview.skipped).toEqual([{ reason: 'unsupported', label: '格式暂不支持', count: 1 }])
  })
})

describe('indexSource', () => {
  it('把目录里的 Markdown 切块入库，条目带来源路径与行区间', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'guide.md'), ['# 部署', '发布前必须跑 npm test。', '', '## 回滚', '按上一版本重新发布。'].join('\n'))
    const store = makeStore()
    const result = await indexSource(store, 'acct', createSource(store, root))
    expect(result.indexedFiles).toBe(1)
    expect(result.source.status).toBe('indexed')
    const entries = store.list('acct', 'p1')
    expect(entries).toHaveLength(2)
    expect(entries.every((entry) => entry.sourcePath === 'guide.md')).toBe(true)
    expect(entries.map((entry) => entry.locator).sort()).toEqual(['L1-3', 'L4-5'])
    expect(entries.some((entry) => entry.title === 'guide.md › 部署')).toBe(true)
  })

  it('内容未变时跳过重切，版本号不变', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'a.md'), '# 标题\n正文内容。')
    const store = makeStore()
    const source = createSource(store, root)
    const first = await indexSource(store, 'acct', source)
    const second = await indexSource(store, 'acct', store.requireSource('acct', source.id))
    expect(second.indexedFiles).toBe(0)
    expect(second.unchangedFiles).toBe(1)
    expect(second.source.version).toBe(first.source.version)
  })

  it('文件内容变化后重切，旧条目被替换', async () => {
    const root = makeRoot()
    const file = join(root, 'a.md')
    writeFileSync(file, '# 标题\n旧内容。')
    const store = makeStore()
    const source = createSource(store, root)
    await indexSource(store, 'acct', source)
    writeFileSync(file, '# 标题\n新内容。')
    const result = await indexSource(store, 'acct', store.requireSource('acct', source.id))
    expect(result.indexedFiles).toBe(1)
    const entries = store.list('acct', 'p1')
    expect(entries).toHaveLength(1)
    expect(entries[0].content).toContain('新内容')
  })

  it('文件被删除后它的条目一并消失', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'a.md'), '# A\n内容甲。')
    writeFileSync(join(root, 'b.md'), '# B\n内容乙。')
    const store = makeStore()
    const source = createSource(store, root)
    await indexSource(store, 'acct', source)
    rmSync(join(root, 'b.md'))
    const result = await indexSource(store, 'acct', store.requireSource('acct', source.id))
    expect(result.removedFiles).toBe(1)
    expect(store.list('acct', 'p1').map((entry) => entry.sourcePath)).toEqual(['a.md'])
  })

  it('来源路径消失时标记 stale，条目不再参与检索', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'a.md'), '# 标题\n发布前必须跑 npm test。')
    const store = makeStore()
    const source = createSource(store, root)
    await indexSource(store, 'acct', source)
    const plan = buildMemoryQueryPlan('发布前要做什么')
    expect(store.search('acct', 'p1', plan, 5).length).toBeGreaterThan(0)

    rmSync(root, { recursive: true, force: true })
    const result = await indexSource(store, 'acct', store.requireSource('acct', source.id))
    expect(result.source.status).toBe('stale')
    // 条目仍在库里（重新挂载后不必重切），但检索不再返回它们
    expect(store.list('acct', 'p1')).toHaveLength(1)
    expect(store.search('acct', 'p1', plan, 5)).toEqual([])
  })

  it('单个文件失败不影响其余文件，失败原因逐条返回', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'ok.md'), '# 正常\n内容。')
    writeFileSync(join(root, 'bad.md'), '# 损坏\n内容。')
    const store = makeStore()
    const readText = vi.fn((path: string) => {
      if (path.includes('bad.md')) throw new Error('读取失败')
      return '# 正常\n内容。'
    })
    const result = await indexSource(store, 'acct', createSource(store, root), { readText })
    expect(result.indexedFiles).toBe(1)
    expect(result.failures).toEqual([{ path: 'bad.md', error: '读取失败' }])
    expect(result.source.status).toBe('indexed')
  })

  it('PDF 按页切块，定位串是页码', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'spec.pdf'), 'pdf-bytes')
    const store = makeStore()
    const extractPdfPages = vi.fn(async () => [{ page: 1, text: '第一页正文' }, { page: 2, text: '第二页正文' }])
    const result = await indexSource(store, 'acct', createSource(store, root), { extractPdfPages })
    expect(result.indexedFiles).toBe(1)
    expect(store.list('acct', 'p1').map((entry) => entry.locator).sort()).toEqual(['p.1', 'p.2'])
  })

  it('扫描件（无文本层）如实报错，不写空条目', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'scan.pdf'), 'pdf-bytes')
    const store = makeStore()
    const result = await indexSource(store, 'acct', createSource(store, root), { extractPdfPages: async () => [] })
    expect(result.source.status).toBe('failed')
    expect(result.failures[0].error).toContain('没有可提取的文本层')
    expect(store.list('acct', 'p1')).toEqual([])
  })

  it('单文件来源按文件名作为相对路径索引', async () => {
    const root = makeRoot()
    const file = join(root, 'notes.md')
    writeFileSync(file, '# 备忘\n一句话。')
    const store = makeStore()
    const result = await indexSource(store, 'acct', createSource(store, file, 'file'))
    expect(result.indexedFiles).toBe(1)
    expect(store.list('acct', 'p1')[0].sourcePath).toBe('notes.md')
  })
})
