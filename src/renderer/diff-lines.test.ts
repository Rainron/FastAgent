import { describe, expect, it } from 'vitest'
import { classifyDiffLine, countDiffLines, toDiffLines } from './diff-lines'

describe('classifyDiffLine', () => {
  it('文件头优先于增删判定', () => {
    expect(classifyDiffLine('--- a/src/a.ts')).toBe('meta')
    expect(classifyDiffLine('+++ b/src/a.ts')).toBe('meta')
    expect(classifyDiffLine('diff --git a/a b/a')).toBe('meta')
    expect(classifyDiffLine('index 7f1c0aa..b92e14d 100644')).toBe('meta')
  })

  it('hunk、增删与上下文', () => {
    expect(classifyDiffLine('@@ -1,3 +1,5 @@')).toBe('hunk')
    expect(classifyDiffLine('+added')).toBe('add')
    expect(classifyDiffLine('-removed')).toBe('del')
    expect(classifyDiffLine(' kept')).toBe('context')
    expect(classifyDiffLine('')).toBe('context')
  })
})

describe('toDiffLines', () => {
  it('丢掉末尾空行并保留行号顺序', () => {
    const lines = toDiffLines('@@ -1 +1 @@\n-old\n+new\n\n')
    expect(lines.map((line) => line.kind)).toEqual(['hunk', 'del', 'add'])
    expect(lines.map((line) => line.id)).toEqual([0, 1, 2])
  })

  it('空 patch 得到空列表', () => {
    expect(toDiffLines('')).toEqual([])
  })
})

describe('countDiffLines', () => {
  it('只数增删行，不把文件头算进去', () => {
    const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n-old\n+new\n+extra\n'
    expect(countDiffLines(patch)).toEqual({ additions: 2, deletions: 1 })
  })
})
