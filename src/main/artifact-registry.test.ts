import { describe, expect, it } from 'vitest'
import { relocateArtifactsUnderPath } from './artifact-registry'
import type { LocalStore } from './local-store'

function fakeStore(paths: string[]) {
  const records = paths.map((path, index) => ({ id: `a${index}`, path, name: path.split('/').pop() }))
  const store = {
    listArtifacts: () => records,
    relocateArtifact: (_namespace: string, id: string, path: string, name: string) => {
      const record = records.find((item) => item.id === id)
      if (record) Object.assign(record, { path, name })
    }
  }
  return { store: store as unknown as LocalStore, records }
}

describe('relocateArtifactsUnderPath', () => {
  it('移动文件或目录后，其下登记的产物路径与名称跟着改', () => {
    const { store, records } = fakeStore(['docs/a.md', 'docs/sub/b.md', 'docs-old/c.md', 'x.md'])
    expect(relocateArtifactsUnderPath(store, 'ns', 'K:/repo', 'docs', 'archive/docs')).toBe(true)
    expect(records.map((item) => item.path)).toEqual(['archive/docs/a.md', 'archive/docs/sub/b.md', 'docs-old/c.md', 'x.md'])
    expect(relocateArtifactsUnderPath(store, 'ns', 'K:/repo', 'x.md', 'notes/x.md')).toBe(true)
    expect(records[3]).toMatchObject({ path: 'notes/x.md', name: 'x.md' })
  })

  it('没有命中时返回 false，不广播刷新', () => {
    const { store } = fakeStore(['a.md'])
    expect(relocateArtifactsUnderPath(store, 'ns', 'K:/repo', 'b.md', 'c/b.md')).toBe(false)
  })
})
