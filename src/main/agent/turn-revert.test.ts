import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RevertableFileChange } from '../local-store/artifact-store'
import { snapshotFile } from './file-ledger'
import { revertFileChanges, revertTurn, type TurnRevertStore } from './turn-revert'

const roots: string[] = []
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fa-revert-'))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function hashOf(path: string) {
  return snapshotFile(path).hash
}

function change(patch: Partial<RevertableFileChange> & Pick<RevertableFileChange, 'path' | 'operation'>): RevertableFileChange {
  return { conversationId: 'c1', afterHash: null, beforeText: null, ...patch }
}

describe('revertFileChanges', () => {
  it('修改过的文件写回原文，换行原样保留', async () => {
    const root = makeRoot()
    const file = join(root, 'a.ts')
    writeFileSync(file, 'new\r\ncontent')
    const result = await revertFileChanges(root, [change({ path: 'a.ts', operation: 'update', afterHash: hashOf(file), beforeText: 'old\r\ncontent\n' })])
    expect(result).toEqual({ reverted: ['a.ts'], skipped: [] })
    expect(readFileSync(file, 'utf8')).toBe('old\r\ncontent\n')
  })

  it('本轮新建的文件被删掉', async () => {
    const root = makeRoot()
    const file = join(root, 'new.md')
    writeFileSync(file, 'x')
    const result = await revertFileChanges(root, [change({ path: 'new.md', operation: 'create', afterHash: hashOf(file) })])
    expect(result.reverted).toEqual(['new.md'])
    expect(existsSync(file)).toBe(false)
  })

  it('本轮删掉的文件按原文恢复，缺的父目录一并补上', async () => {
    const root = makeRoot()
    const result = await revertFileChanges(root, [change({ path: 'docs/gone.md', operation: 'delete', afterHash: null, beforeText: '原文' })])
    expect(result.reverted).toEqual(['docs/gone.md'])
    expect(readFileSync(join(root, 'docs/gone.md'), 'utf8')).toBe('原文')
  })

  it('之后又被改过的文件跳过，不覆盖', async () => {
    const root = makeRoot()
    const file = join(root, 'a.ts')
    writeFileSync(file, 'agent wrote')
    const afterHash = hashOf(file)
    writeFileSync(file, 'user edited later')
    const result = await revertFileChanges(root, [change({ path: 'a.ts', operation: 'update', afterHash, beforeText: 'old' })])
    expect(result.reverted).toEqual([])
    expect(result.skipped).toEqual([{ path: 'a.ts', reason: '这一轮之后文件又被改过' }])
    expect(readFileSync(file, 'utf8')).toBe('user edited later')
  })

  it('删掉的文件之后又被重建过也跳过', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'b.ts'), 'recreated')
    const result = await revertFileChanges(root, [change({ path: 'b.ts', operation: 'delete', afterHash: null, beforeText: 'old' })])
    expect(result.skipped[0]?.reason).toBe('这一轮之后文件又被改过')
    expect(readFileSync(join(root, 'b.ts'), 'utf8')).toBe('recreated')
  })

  it('没存原文、越出工作区、重命名都跳过并给出原因', async () => {
    const root = makeRoot()
    const file = join(root, 'big.bin')
    writeFileSync(file, 'x')
    const result = await revertFileChanges(root, [
      change({ path: 'big.bin', operation: 'update', afterHash: hashOf(file), beforeText: null }),
      change({ path: '../outside.txt', operation: 'update', afterHash: null, beforeText: 'x' }),
      change({ path: 'r.ts', operation: 'rename' })
    ])
    expect(result.reverted).toEqual([])
    expect(result.skipped.map((item) => item.reason)).toEqual(['没有留下改动前的原文', '文件不在工作区内', '重命名暂不支持撤销'])
  })
})

describe('revertTurn', () => {
  function makeStore(root: string | null, changes: RevertableFileChange[]) {
    const marked: string[][] = []
    const store: TurnRevertStore = {
      listRevertableFileChanges: () => changes,
      markFileChangesReverted: (_namespace, _turnId, paths) => { marked.push(paths) },
      getConversationRoot: () => root
    }
    return { store, marked }
  }

  it('只给写回成功的文件打撤销标记', async () => {
    const root = makeRoot()
    const ok = join(root, 'ok.ts')
    writeFileSync(ok, 'agent')
    const { store, marked } = makeStore(root, [
      change({ path: 'ok.ts', operation: 'update', afterHash: hashOf(ok), beforeText: 'before' }),
      change({ path: 'r.ts', operation: 'rename' })
    ])
    const result = await revertTurn(store, 'ns', 't1', '/unused')
    expect(result.reverted).toEqual(['ok.ts'])
    expect(marked).toEqual([['ok.ts']])
  })

  it('会话没有归属项目时落到快速工作区', async () => {
    const quick = makeRoot()
    const file = join(quick, 'q.md')
    writeFileSync(file, 'agent')
    const { store } = makeStore(null, [change({ path: 'q.md', operation: 'create', afterHash: hashOf(file) })])
    await revertTurn(store, 'ns', 't1', quick)
    expect(existsSync(file)).toBe(false)
  })

  it('没有可撤销的改动时什么都不做', async () => {
    const { store, marked } = makeStore('/x', [])
    expect(await revertTurn(store, 'ns', 't1', '/q')).toEqual({ reverted: [], skipped: [] })
    expect(marked).toEqual([])
  })
})
