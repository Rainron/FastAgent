import { describe, expect, it } from 'vitest'
import { buildChangeMenuItems, menuTargetPaths, type ChangeMenuContext } from './change-menu'

const context = (patch: Partial<ChangeMenuContext> = {}): ChangeMenuContext => ({
  kind: 'file', staged: false, collapsed: false, targetCount: 1, multiple: false, ...patch
})

describe('buildChangeMenuItems', () => {
  it('文件行有显示差异与复制文件名，目录行没有', () => {
    expect(buildChangeMenuItems(context()).map((item) => item.key))
      .toEqual(['open', 'stage', 'discard', 'copyPath', 'copyName', 'reveal'])
    expect(buildChangeMenuItems(context({ kind: 'dir' })).map((item) => item.key))
      .toEqual(['toggleDir', 'stage', 'discard', 'copyPath', 'reveal'])
  })

  it('已暂存组的暂存项变成移除', () => {
    const [, stage] = buildChangeMenuItems(context({ staged: true }))
    expect(stage.label).toBe('从暂存区移除')
  })

  it('目录折叠状态决定展开还是折叠文案', () => {
    expect(buildChangeMenuItems(context({ kind: 'dir', collapsed: true }))[0].label).toBe('展开目录')
    expect(buildChangeMenuItems(context({ kind: 'dir', collapsed: false }))[0].label).toBe('折叠目录')
  })

  it('多目标时文案带上数量', () => {
    const items = buildChangeMenuItems(context({ targetCount: 3, multiple: true }))
    expect(items.find((item) => item.key === 'stage')?.label).toBe('加入暂存区 3 个文件')
    expect(items.find((item) => item.key === 'discard')?.label).toBe('丢弃改动 3 个文件')
  })

  it('丢弃标记为危险项', () => {
    expect(buildChangeMenuItems(context()).find((item) => item.key === 'discard')?.danger).toBe(true)
  })
})

describe('menuTargetPaths', () => {
  it('右键行不在选区里时只操作这一行', () => {
    expect(menuTargetPaths(['a.ts'], new Set(['b.ts', 'c.ts']))).toEqual(['a.ts'])
  })

  it('右键行在多选里时操作整个选区', () => {
    expect(menuTargetPaths(['a.ts'], new Set(['a.ts', 'b.ts'])).sort()).toEqual(['a.ts', 'b.ts'])
  })

  it('选区恰好等于这一行时不扩大范围', () => {
    expect(menuTargetPaths(['a.ts'], new Set(['a.ts']))).toEqual(['a.ts'])
  })

  it('目录行覆盖的文件全在选区、但选区更大时按选区走', () => {
    expect(menuTargetPaths(['d/a.ts', 'd/b.ts'], new Set(['d/a.ts', 'd/b.ts', 'x.ts'])).sort())
      .toEqual(['d/a.ts', 'd/b.ts', 'x.ts'])
  })

  it('目录行只有部分文件被选中时只操作该目录', () => {
    expect(menuTargetPaths(['d/a.ts', 'd/b.ts'], new Set(['d/a.ts', 'x.ts']))).toEqual(['d/a.ts', 'd/b.ts'])
  })
})
