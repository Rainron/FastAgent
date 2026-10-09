import { describe, expect, it } from 'vitest'
import type { GitFileChange } from '../../shared/types'
import {
  buildChangeTree,
  compressSingleChildDirs,
  flatChangeRows,
  flattenChangeRows,
  groupChangesByStatus,
  pathsSelectionState,
  splitUnversioned,
  togglePaths,
  toggleCollapsed
} from './change-tree'

const file = (path: string, status = 'M', extra: Partial<GitFileChange> = {}): GitFileChange => ({
  path, status, untracked: false, additions: 1, deletions: 1, binary: false, ...extra
})

describe('buildChangeTree', () => {
  it('按路径分段建树，目录在前文件在后', () => {
    const nodes = buildChangeTree([file('readme.md'), file('src/b.ts'), file('src/a.ts')])
    expect(nodes.map((node) => [node.kind, node.name])).toEqual([['dir', 'src'], ['file', 'readme.md']])
    expect(nodes[0].children.map((node) => node.name)).toEqual(['a.ts', 'b.ts'])
  })

  it('同一目录下的多个文件共用一个目录节点', () => {
    const nodes = buildChangeTree([file('src/a.ts'), file('src/b.ts')])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].children).toHaveLength(2)
  })

  it('目录节点的 path 是完整相对路径', () => {
    const nodes = buildChangeTree([file('src/main/a.ts')])
    expect(nodes[0].path).toBe('src')
    expect(nodes[0].children[0].path).toBe('src/main')
  })
})

describe('compressSingleChildDirs', () => {
  it('单子目录链并成一行', () => {
    const nodes = compressSingleChildDirs(buildChangeTree([file('src/main/java/App.java')]))
    expect(nodes[0].name).toBe('src/main/java')
    expect(nodes[0].path).toBe('src/main/java')
    expect(nodes[0].children.map((node) => node.name)).toEqual(['App.java'])
  })

  it('目录下有多个子节点时不压缩', () => {
    const nodes = compressSingleChildDirs(buildChangeTree([file('src/a.ts'), file('src/main/b.ts')]))
    expect(nodes[0].name).toBe('src')
  })

  it('只有一个子文件时也不压缩，文件不该并进目录名', () => {
    const nodes = compressSingleChildDirs(buildChangeTree([file('src/a.ts')]))
    expect(nodes[0].name).toBe('src')
    expect(nodes[0].children[0].name).toBe('a.ts')
  })
})

describe('flattenChangeRows', () => {
  const nodes = compressSingleChildDirs(buildChangeTree([file('src/a.ts'), file('src/b.ts'), file('readme.md')]))

  it('默认全部展开，深度随层级递增', () => {
    const rows = flattenChangeRows(nodes, new Set())
    expect(rows.map((row) => [row.name, row.depth])).toEqual([['src', 0], ['a.ts', 1], ['b.ts', 1], ['readme.md', 0]])
  })

  it('折叠集里的目录不展开子节点', () => {
    const rows = flattenChangeRows(nodes, new Set(['src']))
    expect(rows.map((row) => row.name)).toEqual(['src', 'readme.md'])
  })

  it('目录行汇总覆盖的文件路径与增删数', () => {
    const rows = flattenChangeRows(nodes, new Set(['src']))
    expect(rows[0].paths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(rows[0].additions).toBe(2)
    expect(rows[0].deletions).toBe(2)
  })
})

describe('flatChangeRows', () => {
  it('保持 git 原始顺序，名称用完整路径', () => {
    const rows = flatChangeRows([file('src/b.ts'), file('a.ts')])
    expect(rows.map((row) => row.name)).toEqual(['src/b.ts', 'a.ts'])
  })
})

describe('groupChangesByStatus', () => {
  it('按类型分组并把冲突排在最前', () => {
    const groups = groupChangesByStatus([file('a.ts', 'M'), file('b.ts', 'A'), file('c.ts', 'U')])
    expect(groups.map((group) => group.code)).toEqual(['U', 'A', 'M'])
    expect(groups[0].label).toBe('冲突')
  })

  it('未跟踪文件归到 ? 组，不看 status 字段', () => {
    const groups = groupChangesByStatus([file('new.ts', 'A', { untracked: true })])
    expect(groups[0].code).toBe('?')
    expect(groups[0].label).toBe('未跟踪')
  })

  it('未知状态码排在已知类型之后', () => {
    const groups = groupChangesByStatus([file('a.ts', 'X'), file('b.ts', 'M')])
    expect(groups.map((group) => group.code)).toEqual(['M', 'X'])
  })
})

describe('splitUnversioned', () => {
  it('按 untracked 拆成已修改与未纳管两组', () => {
    const result = splitUnversioned([file('a.ts'), file('new.png', 'A', { untracked: true }), file('b.ts', 'D')])
    expect(result.modified.map((item) => item.path)).toEqual(['a.ts', 'b.ts'])
    expect(result.unversioned.map((item) => item.path)).toEqual(['new.png'])
  })

  it('组内保持原顺序', () => {
    const result = splitUnversioned([file('z.ts'), file('a.ts')])
    expect(result.modified.map((item) => item.path)).toEqual(['z.ts', 'a.ts'])
    expect(result.unversioned).toEqual([])
  })
})

describe('选择与折叠', () => {
  it('三态勾选', () => {
    expect(pathsSelectionState(['a', 'b'], new Set(['a', 'b']))).toBe('all')
    expect(pathsSelectionState(['a', 'b'], new Set(['a']))).toBe('partial')
    expect(pathsSelectionState(['a', 'b'], new Set())).toBe('none')
    expect(pathsSelectionState([], new Set(['a']))).toBe('none')
  })

  it('目录勾选：部分选中时补全，全选时整组取消', () => {
    expect([...togglePaths(new Set(['a']), ['a', 'b'])].sort()).toEqual(['a', 'b'])
    expect([...togglePaths(new Set(['a', 'b']), ['a', 'b'])]).toEqual([])
  })

  it('目录勾选不动组外的选中项', () => {
    expect([...togglePaths(new Set(['x']), ['a'])].sort()).toEqual(['a', 'x'])
  })

  it('折叠集开关', () => {
    expect([...toggleCollapsed(new Set(), 'src')]).toEqual(['src'])
    expect([...toggleCollapsed(new Set(['src']), 'src')]).toEqual([])
  })
})
