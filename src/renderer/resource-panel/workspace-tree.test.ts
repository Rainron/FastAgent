import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from '../../shared/types'
import { flattenTreeRows, matchesTreeKeyword } from './workspace-tree'

function entry(name: string, kind: WorkspaceEntry['kind'], extra: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return { name, path: name, kind, ...extra }
}

describe('flattenTreeRows', () => {
  const children: Map<string, WorkspaceEntry[]> = new Map([
    ['', [entry('src', 'dir'), entry('README.md', 'file', { size: 5, fileType: 'md' })]],
    ['src', [entry('main.ts', 'file', { size: 12, fileType: 'ts' }), entry('configs', 'dir', { path: 'src/configs' })]],
    ['src/configs', [entry('app.json', 'file', { path: 'src/configs/app.json', size: 3, fileType: 'json' })]]
  ])

  it('未展开时只显示根级', () => {
    const rows = flattenTreeRows(children, new Set())
    expect(rows.map((row) => row.path)).toEqual(['src', 'README.md'])
    expect(rows[0]).toMatchObject({ depth: 0, kind: 'dir' })
  })

  it('展开目录后按 DFS 顺序带缩进深度', () => {
    const rows = flattenTreeRows(children, new Set(['src']))
    expect(rows.map((row) => row.path)).toEqual(['src', 'main.ts', 'src/configs', 'README.md'])
    expect(rows[1].depth).toBe(1)
    expect(rows[2].depth).toBe(1)
  })

  it('嵌套展开与文件元信息透传', () => {
    const rows = flattenTreeRows(children, new Set(['src', 'src/configs']))
    const app = rows.find((row) => row.path === 'src/configs/app.json')
    expect(app).toMatchObject({ depth: 2, size: 3, fileType: 'json' })
  })

  it('已展开但未加载的目录只保留目录行', () => {
    const rows = flattenTreeRows(children, new Set(['missing']))
    expect(rows.map((row) => row.path)).toEqual(['src', 'README.md'])
  })

  it('根目录未加载时返回空', () => {
    expect(flattenTreeRows(new Map(), new Set())).toEqual([])
  })
})

describe('matchesTreeKeyword', () => {
  it('匹配文件名与相对路径子串', () => {
    expect(matchesTreeKeyword('src/App.tsx', 'App.tsx', 'app')).toBe(true)
    expect(matchesTreeKeyword('src/App.tsx', 'App.tsx', 'src/app')).toBe(true)
  })

  it('空关键字匹配全部', () => {
    expect(matchesTreeKeyword('a', 'b', '')).toBe(true)
  })

  it('子序列匹配大小写不敏感', () => {
    expect(matchesTreeKeyword('src/App.tsx', 'App.tsx', 'apptsx')).toBe(true)
    expect(matchesTreeKeyword('src/App.tsx', 'App.tsx', 'xyz')).toBe(false)
  })
})
