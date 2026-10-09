import { describe, expect, it } from 'vitest'
import { canDropInto, dropDirFor, parentPath, remapMovedPath } from './tree-drag'

const file = (path: string) => ({ path, kind: 'file' as const })
const dir = (path: string) => ({ path, kind: 'dir' as const })

describe('dropDirFor', () => {
  it('目录就是自己，文件落到所在目录，根目录下的文件落到根', () => {
    expect(dropDirFor(dir('src'))).toBe('src')
    expect(dropDirFor(file('src/a.ts'))).toBe('src')
    expect(dropDirFor(file('a.md'))).toBe('')
    expect(parentPath('a/b/c')).toBe('a/b')
  })
})

describe('canDropInto', () => {
  it('可以放进别的目录或根目录', () => {
    expect(canDropInto([file('a.md')], 'docs')).toBe(true)
    expect(canDropInto([file('docs/a.md')], '')).toBe(true)
  })

  it('目录不能进自己或子目录；同名前缀的兄弟目录不算子目录', () => {
    expect(canDropInto([dir('src')], 'src')).toBe(false)
    expect(canDropInto([dir('src')], 'src/nested')).toBe(false)
    expect(canDropInto([dir('src')], 'src-old')).toBe(true)
  })

  it('全部已在目标目录里时不可放；部分在就可以', () => {
    expect(canDropInto([file('docs/a.md')], 'docs')).toBe(false)
    expect(canDropInto([file('docs/a.md'), file('b.md')], 'docs')).toBe(true)
  })

  it('空拖动与根目录本身都不可放', () => {
    expect(canDropInto([], 'docs')).toBe(false)
    expect(canDropInto([dir('')], 'docs')).toBe(false)
  })
})

describe('remapMovedPath', () => {
  it('被移动项本身与其后代换前缀，无关路径不变', () => {
    const moves = [{ from: 'src', to: 'lib/src' }]
    expect(remapMovedPath('src', moves)).toBe('lib/src')
    expect(remapMovedPath('src/a/b.ts', moves)).toBe('lib/src/a/b.ts')
    expect(remapMovedPath('src-old/x', moves)).toBe('src-old/x')
  })
})
