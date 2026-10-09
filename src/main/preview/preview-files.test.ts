import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PreviewRootRegistry, resolvePreviewFile } from './preview-files'
import { rootToken } from './preview-url'

let base: string
let root: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'fa-preview-'))
  root = join(base, 'workspace')
  mkdirSync(join(root, 'site', 'css'), { recursive: true })
  writeFileSync(join(root, 'site', 'index.html'), '<h1>hi</h1>')
  writeFileSync(join(root, 'site', 'css', 'app.css'), 'body{}')
  writeFileSync(join(base, 'secret.txt'), 'top secret')
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('resolvePreviewFile', () => {
  it('解析工作区内文件', async () => {
    expect(await resolvePreviewFile(root, 'site/css/app.css')).toEqual({ ok: true, absolutePath: join(root, 'site', 'css', 'app.css') })
  })

  it('目录取 index.html', async () => {
    expect(await resolvePreviewFile(root, 'site')).toEqual({ ok: true, absolutePath: join(root, 'site', 'index.html') })
  })

  it('不存在返回 404，目录没有 index 也是 404', async () => {
    expect(await resolvePreviewFile(root, 'site/missing.js')).toEqual({ ok: false, status: 404 })
    expect(await resolvePreviewFile(root, 'site/css')).toEqual({ ok: false, status: 404 })
  })

  it('越界路径返回 403', async () => {
    expect(await resolvePreviewFile(root, '../secret.txt')).toEqual({ ok: false, status: 403 })
  })

  it('指向工作区外的符号链接返回 403', async () => {
    try {
      symlinkSync(join(base, 'secret.txt'), join(root, 'site', 'leak.txt'), 'file')
    } catch {
      // Windows 未开开发者模式时无权建符号链接，这条跳过
      return
    }
    expect(await resolvePreviewFile(root, 'site/leak.txt')).toEqual({ ok: false, status: 403 })
  })
})

describe('PreviewRootRegistry', () => {
  it('登记过的根按主机名反查', () => {
    const registry = new PreviewRootRegistry()
    const token = registry.register(root)
    expect(token).toBe(rootToken(root))
    expect(registry.resolve(token)).toBe(root)
  })

  it('没登记时从候选根里找，找不到返回 null', () => {
    const registry = new PreviewRootRegistry(() => [null, undefined, join(base, 'other'), root])
    expect(registry.resolve(rootToken(root))).toBe(root)
    expect(registry.resolve(rootToken(base))).toBeNull()
  })
})
