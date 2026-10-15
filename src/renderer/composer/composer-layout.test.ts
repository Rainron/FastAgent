import { describe, expect, it } from 'vitest'
import { composerLayout, type ComposerLayoutInput } from './composer-layout'

const input: ComposerLayoutInput = { width: 900, running: false, hasDraft: false, workspace: true, branch: true, permission: true, reasoning: true, plan: false }

describe('composerLayout', () => {
  it('宽容器保留单行，窄容器收纳并使用双行', () => {
    expect(composerLayout(input)).toMatchObject({ rows: 1, overflow: false })
    for (const width of [320, 400, 480]) expect(composerLayout({ ...input, width })).toMatchObject({ rows: 2, overflow: true })
    expect(composerLayout({ ...input, width: 640 })).toMatchObject({ rows: 1, overflow: true })
  })
  it('运行操作和计划标记占据空间时提前使用双行', () => {
    expect(composerLayout({ ...input, width: 640, running: true, hasDraft: true, plan: true }).rows).toBe(2)
  })
  it('字体放大按实际可用空间降级，快速对话无需项目空间', () => {
    expect(composerLayout({ ...input, fontScale: 1.5 }).overflow).toBe(true)
    expect(composerLayout({ ...input, width: 480, workspace: false, branch: false, permission: false, reasoning: false }).rows).toBe(1)
    expect(composerLayout({ ...input, width: 320 }).iconContext).toBe(true)
  })
})
