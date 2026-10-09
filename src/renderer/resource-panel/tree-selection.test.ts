import { describe, expect, it } from 'vitest'
import { marqueeHits, mergeSelection, rangeSelection, selectionMentionText, selectionSummary, toggleSelection, topLevelSelection, type TreeSelectionItem } from './tree-selection'

const file = (path: string): TreeSelectionItem => ({ path, kind: 'file' })
const dir = (path: string): TreeSelectionItem => ({ path, kind: 'dir' })

describe('toggleSelection', () => {
  it('没选中就加上，选中了就去掉；根目录不参与多选', () => {
    const once = toggleSelection([], file('a.md'))
    expect(once).toEqual([file('a.md')])
    expect(toggleSelection(once, dir('src'))).toEqual([file('a.md'), dir('src')])
    expect(toggleSelection(once, file('a.md'))).toEqual([])
    expect(toggleSelection(once, dir(''))).toBe(once)
  })
})

describe('rangeSelection', () => {
  const order = [dir(''), dir('src'), file('src/a.ts'), file('b.md'), file('c.md')]

  it('锚点到目标之间按可见顺序全选，方向无关', () => {
    expect(rangeSelection(order, 'src/a.ts', file('c.md')).map((entry) => entry.path)).toEqual(['src/a.ts', 'b.md', 'c.md'])
    expect(rangeSelection(order, 'c.md', dir('src')).map((entry) => entry.path)).toEqual(['src', 'src/a.ts', 'b.md', 'c.md'])
  })

  it('范围跨过根目录时把根排除', () => {
    expect(rangeSelection(order, '', file('src/a.ts')).map((entry) => entry.path)).toEqual(['src', 'src/a.ts'])
  })

  it('锚点不可见或没有锚点时只选目标', () => {
    expect(rangeSelection(order, 'gone.ts', file('b.md'))).toEqual([file('b.md')])
    expect(rangeSelection(order, null, file('b.md'))).toEqual([file('b.md')])
  })
})

describe('topLevelSelection', () => {
  it('去掉已被选中目录覆盖的后代，保持顺序；同名前缀不算后代', () => {
    expect(topLevelSelection([file('src/a.ts'), dir('src'), file('src-old/b.ts'), dir('src/nested')]).map((entry) => entry.path)).toEqual(['src', 'src-old/b.ts'])
  })
})

describe('selectionSummary / selectionMentionText', () => {
  it('摘要只列非零项', () => {
    expect(selectionSummary([file('a'), file('b'), dir('c')])).toBe('2 个文件 · 1 个目录')
    expect(selectionSummary([dir('c')])).toBe('1 个目录')
  })

  it('引用文本是空格分隔的相对路径', () => {
    expect(selectionMentionText([file('a.md'), dir('src')])).toBe('a.md src ')
  })
})

describe('marqueeHits / mergeSelection', () => {
  const rows = [
    { path: '', kind: 'dir' as const, top: 0, bottom: 30 },
    { path: 'a.md', kind: 'file' as const, top: 30, bottom: 60 },
    { path: 'src', kind: 'dir' as const, top: 60, bottom: 90 },
    { path: 'z.md', kind: 'file' as const, top: 90, bottom: 120 }
  ]

  it('与选框纵向交叠的行都命中，贴边不算，根目录排除', () => {
    expect(marqueeHits(rows, 10, 70).map((entry) => entry.path)).toEqual(['a.md', 'src'])
    expect(marqueeHits(rows, 60, 90).map((entry) => entry.path)).toEqual(['src'])
  })

  it('追加框选取并集，原有项在前', () => {
    expect(mergeSelection([file('z.md')], [file('a.md'), file('z.md')]).map((entry) => entry.path)).toEqual(['z.md', 'a.md'])
  })
})
