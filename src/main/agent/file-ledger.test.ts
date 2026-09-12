import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyOperation, diffSnapshots, MAX_DIFF_LINES, snapshotFile, type FileSnapshot } from './file-ledger'

const roots: string[] = []
afterEach(() => { while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true }) })

function tempFile(content: string, name = 'a.txt'): string {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-ledger-'))
  roots.push(root)
  const path = join(root, name)
  writeFileSync(path, content, 'utf8')
  return path
}

function textSnapshot(lines: string[]): FileSnapshot {
  return { exists: true, hash: lines.join('\n'), lines, size: 0 }
}

const missing: FileSnapshot = { exists: false, hash: '', lines: null, size: 0 }

describe('snapshotFile', () => {
  it('读不到的路径按不存在处理，不抛异常', () => {
    expect(snapshotFile(join(tmpdir(), 'fastagent-not-here-xyz'))).toMatchObject({ exists: false, lines: null })
  })

  it('文本文件给出逐行内容与稳定哈希', () => {
    const path = tempFile('a\nb\n')
    const first = snapshotFile(path)
    expect(first.exists).toBe(true)
    expect(first.lines).toEqual(['a', 'b', ''])
    expect(snapshotFile(path).hash).toBe(first.hash)
  })

  it('二进制文件不给行内容，避免把控制字符写进库', () => {
    const path = tempFile('a\u0000b', 'bin.dat')
    expect(snapshotFile(path)).toMatchObject({ exists: true, lines: null })
  })
})

describe('classifyOperation', () => {
  it('基线不存在而当前存在 = 新建', () => {
    expect(classifyOperation(missing, textSnapshot(['a']))).toBe('create')
  })

  it('基线存在而当前不存在 = 删除', () => {
    expect(classifyOperation(textSnapshot(['a']), missing)).toBe('delete')
  })

  it('内容变了 = 修改，没变则没有变更', () => {
    expect(classifyOperation(textSnapshot(['a']), textSnapshot(['b']))).toBe('update')
    expect(classifyOperation(textSnapshot(['a']), textSnapshot(['a']))).toBeNull()
  })

  it('新建后又删掉，整轮看等于什么都没发生', () => {
    expect(classifyOperation(missing, missing)).toBeNull()
  })
})

describe('diffSnapshots', () => {
  it('统计增删行并给出可展示的 diff', () => {
    const result = diffSnapshots(textSnapshot(['keep', 'old', 'tail']), textSnapshot(['keep', 'new', 'more', 'tail']))
    expect(result).toMatchObject({ additions: 2, deletions: 1 })
    expect(result.text).toContain('-old')
    expect(result.text).toContain('+new')
  })

  it('新建文件的全部内容都算新增', () => {
    expect(diffSnapshots(missing, textSnapshot(['a', 'b', 'c']))).toMatchObject({ additions: 3, deletions: 0 })
  })

  it('删除文件的全部内容都算删除', () => {
    expect(diffSnapshots(textSnapshot(['a', 'b']), missing)).toMatchObject({ additions: 0, deletions: 2 })
  })

  it('内容相同不产生增删', () => {
    expect(diffSnapshots(textSnapshot(['a']), textSnapshot(['a']))).toMatchObject({ additions: 0, deletions: 0, text: '' })
  })

  it('二进制 / 超大文件比不出行，交给调用方回落到工具自报统计', () => {
    expect(diffSnapshots({ exists: true, hash: 'x', lines: null, size: 9 }, textSnapshot(['a']))).toMatchObject({ additions: 0, deletions: 0, text: '' })
  })

  it('改动块过大时只给行数不给逐行 diff，避免 LCS 把主进程卡住', () => {
    const before = Array.from({ length: MAX_DIFF_LINES + 10 }, (_, index) => `old ${index}`)
    const after = Array.from({ length: MAX_DIFF_LINES + 20 }, (_, index) => `new ${index}`)
    const result = diffSnapshots(textSnapshot(before), textSnapshot(after))
    expect(result.additions).toBe(after.length)
    expect(result.deletions).toBe(before.length)
    expect(result.text).toBe('')
  })
})
