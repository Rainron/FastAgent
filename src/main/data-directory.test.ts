import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { moveManagedData } from './data-directory'

const roots: string[] = []

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-move-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('managed data directory', () => {
  it('复制并校验完整数据目录，不删除原目录', () => {
    const root = tempRoot()
    const source = join(root, 'source')
    const target = join(root, 'target')
    mkdirSync(join(source, 'data'), { recursive: true })
    mkdirSync(join(source, 'skills', 'demo'), { recursive: true })
    const db = new Database(join(source, 'data', 'fastagent.db'))
    db.exec('CREATE TABLE marker(value TEXT)')
    db.prepare('INSERT INTO marker(value) VALUES (?)').run('ok')
    db.close()
    writeFileSync(join(source, 'skills', 'demo', 'SKILL.md'), '# demo\n', 'utf8')

    const result = moveManagedData(source, target)

    expect(result.targetRoot).toBe(target)
    expect(readFileSync(join(target, 'skills', 'demo', 'SKILL.md'), 'utf8')).toContain('demo')
    expect(existsSync(join(source, 'data', 'fastagent.db'))).toBe(true)
    const moved = new Database(join(target, 'data', 'fastagent.db'), { readonly: true })
    expect(moved.pragma('integrity_check', { simple: true })).toBe('ok')
    moved.close()
  })

  it('拒绝非空目标目录和相互嵌套的目录', () => {
    const root = tempRoot()
    const source = join(root, 'source')
    const target = join(root, 'target')
    mkdirSync(join(source, 'data'), { recursive: true })
    writeFileSync(join(source, 'data', 'fastagent.db'), '', 'utf8')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'keep.txt'), 'keep', 'utf8')

    expect(() => moveManagedData(source, target)).toThrow('目标目录必须为空')
    expect(() => moveManagedData(source, join(source, 'nested'))).toThrow('不能互相包含')
  })
})
