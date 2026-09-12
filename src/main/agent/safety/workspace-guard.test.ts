import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveToolPath } from './workspace-guard'

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-ws-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1\n')
  return root
}

const roots: string[] = []

function makeRootKeep(): string {
  const root = makeRoot()
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('workspace guard', () => {
  it('工作区内的相对路径解析为内部路径', () => {
    const root = makeRootKeep()
    const result = resolveToolPath('src/index.ts', root)
    expect(result.external).toBe(false)
    expect(result.relativePath).toBe(join('src', 'index.ts'))
    expect(result.absolutePath).toBe(join(root, 'src', 'index.ts'))
  })

  it('../ 越界判为外部', () => {
    const root = makeRootKeep()
    const result = resolveToolPath('../outside.txt', root)
    expect(result.external).toBe(true)
    expect(result.relativePath).toBe(join('..', 'outside.txt'))
  })

  it('绝对路径不受工作区限制时判为外部', () => {
    const root = makeRootKeep()
    const outside = makeRootKeep()
    const result = resolveToolPath(join(outside, 'a.txt'), root)
    expect(result.external).toBe(true)
  })

  it('不存在的目标取最近存在的父目录做 realpath', () => {
    const root = makeRootKeep()
    const result = resolveToolPath('src/deep/new-file.ts', root)
    expect(result.external).toBe(false)
    expect(result.relativePath).toBe(join('src', 'deep', 'new-file.ts'))
    expect(result.absolutePath).toBe(join(root, 'src', 'deep', 'new-file.ts'))
  })

  it('symlink/junction 指向工作区外时判为外部', (context) => {
    const root = makeRootKeep()
    const outside = makeRootKeep()
    let linkCreated = true
    try {
      symlinkSync(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      linkCreated = false
    }
    if (!linkCreated) {
      context.skip()
      return
    }
    const result = resolveToolPath('link/secret.txt', root)
    expect(result.external).toBe(true)
  })

  it('symlink 指向工作区内时仍算内部', (context) => {
    const root = makeRootKeep()
    const insideTarget = join(root, 'src')
    let linkCreated = true
    try {
      symlinkSync(insideTarget, join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      linkCreated = false
    }
    if (!linkCreated) {
      context.skip()
      return
    }
    const result = resolveToolPath('alias/index.ts', root)
    expect(result.external).toBe(false)
  })

  it('UNC 路径一律判为外部', () => {
    const root = makeRootKeep()
    expect(resolveToolPath('\\\\server\\share\\file.txt', root).external).toBe(true)
    expect(resolveToolPath('\\\\?\\C:\\some\\file.txt', root).external).toBe(true)
  })

  it('空路径视为工作区本身', () => {
    const root = makeRootKeep()
    const result = resolveToolPath('', root)
    expect(result.external).toBe(false)
    expect(result.relativePath).toBe('.')
  })
})