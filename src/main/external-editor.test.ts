import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDraft, draftFilePath, isDraftPath, launchConfiguredEditor, readDraft, removeDraft } from './external-editor'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'external-editor-test-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('draftFilePath', () => {
  it('生成系统临时目录下带前缀的 md 文件路径', () => {
    const path = draftFilePath()
    expect(path.startsWith(tmpdir())).toBe(true)
    expect(path).toContain('fastagent-draft-')
    expect(path.endsWith('.md')).toBe(true)
  })

  it('不同时间戳生成不同路径，避免并发冲突', () => {
    expect(draftFilePath(1)).not.toBe(draftFilePath(2))
  })
})

describe('createDraft / readDraft / removeDraft', () => {
  it('写入后能原样读回', () => {
    const path = join(dir, 'fastagent-draft-a.md')
    createDraft('第一行\n第二行', path)
    expect(readDraft(path)).toBe('第一行\n第二行')
  })

  it('读回使用 UTF-8 无 BOM', async () => {
    const path = join(dir, 'fastagent-draft-b.md')
    createDraft('中文内容', path)
    const raw = await readFile(path)
    expect(raw[0]).not.toBe(0xef)
  })

  it('文件不存在时读回 null 而不是抛错', () => {
    expect(readDraft(join(dir, 'fastagent-draft-missing.md'))).toBeNull()
  })

  it('删除后文件不再可读', () => {
    const path = join(dir, 'fastagent-draft-c.md')
    createDraft('temp', path)
    removeDraft(path)
    expect(readDraft(path)).toBeNull()
  })
})

describe('launchConfiguredEditor', () => {
  it('未配置时返回 false，由调用方退回系统默认应用', () => {
    const draftPath = join(dir, 'fastagent-draft-edit.md')
    createDraft('x', draftPath)
    expect(launchConfiguredEditor(draftPath, '')).toBe(false)
    expect(launchConfiguredEditor(draftPath, '   ')).toBe(false)
  })

  it('配置的路径不存在时返回 false', () => {
    const draftPath = join(dir, 'fastagent-draft-edit.md')
    expect(launchConfiguredEditor(draftPath, join(dir, 'no-such-editor.exe'))).toBe(false)
  })

  it('路径存在但不可执行时返回 false 且不抛异常（Windows 同步 EACCES）', () => {
    const draftPath = join(dir, 'fastagent-draft-edit.md')
    createDraft('x', draftPath)
    expect(launchConfiguredEditor(draftPath, draftPath, () => {})).toBe(false)
  })
})

describe('isDraftPath', () => {
  it('放行临时目录下的草稿文件', () => {
    expect(isDraftPath(draftFilePath())).toBe(true)
    expect(isDraftPath(join(tmpdir(), 'fastagent-draft-1.md'))).toBe(true)
  })

  it('拒绝任意路径，防止借 IPC 读写其它文件', () => {
    expect(isDraftPath('K:/cc-project/notes.md')).toBe(false)
    expect(isDraftPath(join(tmpdir(), 'other.txt'))).toBe(false)
    expect(isDraftPath(join(dir, 'fastagent-draft-x.md'))).toBe(false)
    expect(isDraftPath(join(tmpdir(), 'fastagent-draft-1.exe'))).toBe(false)
  })
})
