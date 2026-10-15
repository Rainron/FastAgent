import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openWorkspaceFile } from './open-workspace-file'

describe('openWorkspaceFile', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'fastagent-open-')); await writeFile(join(root, 'file.md'), '# test') })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })
  it('打开原文件并传回系统应用失败信息', async () => {
    const open = vi.fn().mockResolvedValue('没有默认应用')
    expect(await openWorkspaceFile(root, 'file.md', root, open)).toBe('没有默认应用')
    expect(open).toHaveBeenCalledWith(expect.stringContaining('file.md'))
  })
  it('拒绝过期工作区、越界和不存在的文件', async () => {
    const open = vi.fn()
    expect(await openWorkspaceFile(root, 'file.md', join(root, 'other'), open)).toContain('工作区已切换')
    expect(await openWorkspaceFile(root, '../file.md', root, open)).toContain('工作区内')
    expect(await openWorkspaceFile(root, 'missing.md', root, open)).toContain('ENOENT')
    expect(open).not.toHaveBeenCalled()
  })
  it('兼容旧调用并捕获系统应用异常', async () => {
    expect(await openWorkspaceFile(root, 'file.md', undefined, async () => '')).toBe('')
    expect(await openWorkspaceFile(root, 'file.md', root, async () => { throw new Error('权限不足') })).toBe('权限不足')
    expect(await openWorkspaceFile(null, 'file.md', undefined, vi.fn())).toContain('尚未打开')
  })
})
