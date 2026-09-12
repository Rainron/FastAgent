import { describe, expect, it } from 'vitest'
import { toggleSidebarSection } from './sidebar-sections'

describe('侧栏分组状态', () => {
  it('只切换被点击的分组并保留另一个分组状态', () => {
    expect(toggleSidebarSection({ workspace: true, recent: false }, 'workspace')).toEqual({ workspace: false, recent: false })
    expect(toggleSidebarSection({ workspace: false, recent: false }, 'recent')).toEqual({ workspace: false, recent: true })
  })
})
