import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * realpath 解析失败的兜底：沙箱账户对宿主用户目录没有 realpath 权限时，
 * 不能因为解析失败把工作区内的正常调用判成越界或直接抛异常。
 * 这里把 node:fs 的 realpathSync 换成必定抛错的实现，单独一个文件避免影响其他用例。
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const denied = () => { throw new Error('EACCES: realpath 被拒绝') }
  return { ...actual, realpathSync: Object.assign(denied, { native: denied }) }
})

const { resolveToolPath } = await import('./workspace-guard')

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-ws-nofs-'))
  roots.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1\n')
  return root
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('workspace guard realpath 兜底', () => {
  it('realpath 抛错时退回词法路径，工作区内仍判为内部', () => {
    const root = makeRoot()
    const result = resolveToolPath('src/index.ts', root)
    expect(result.external).toBe(false)
    expect(result.relativePath).toBe(join('src', 'index.ts'))
    // 词法路径而不是 realpath 后的路径：Windows 短路径 / 大小写转换会污染变更账本
    expect(result.absolutePath).toBe(resolve(root, 'src', 'index.ts'))
  })

  it('realpath 抛错时越界判定照旧', () => {
    const root = makeRoot()
    expect(resolveToolPath('../outside.txt', root).external).toBe(true)
    expect(resolveToolPath(resolve(root, '..', 'outside.txt'), root).external).toBe(true)
  })
})
