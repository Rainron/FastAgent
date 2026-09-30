import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalStore } from './local-store'

const defaultRoot = join(tmpdir(), 'fa-kb-test')

vi.mock('electron', () => ({
  app: { getPath: () => defaultRoot },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (v: string) => Buffer.from(v), decryptString: (b: Buffer) => b.toString() }
}))

const roots: string[] = []
afterEach(() => { while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true }) })

function makeStore() {
  const root = mkdtempSync(join(tmpdir(), 'fa-kb-'))
  roots.push(root)
  return new LocalStore(join(root, 'fastagent.db'))
}

describe('KbStore', () => {
  it('增改删走 FTS 同步，检索命中中文与英文', () => {
    const store = makeStore()
    const project = store.upsertProject('ns', { id: 'p-demo', name: 'demo', path: 'K:/demo', color: 'calm' })
    store.saveKbEntry('ns', project.id, { title: '部署约定', content: '发布前必须跑 npm test 与 typecheck' })
    store.saveKbEntry('ns', project.id, { title: 'release flow', content: 'use git-flow to manage branches' })
    const hit = store.searchKbEntries('ns', project.id, { match: '"部署约定"', likeTerms: [] }, 5)
    expect(hit).toHaveLength(1)
    expect(hit[0].title).toBe('部署约定')
    const english = store.searchKbEntries('ns', project.id, { match: '"git-flow"', likeTerms: [] }, 5)
    expect(english[0].title).toBe('release flow')
    // 更新后旧词不再命中
    store.saveKbEntry('ns', project.id, { id: hit[0].id, title: '部署约定', content: '改成只跑 typecheck' })
    expect(store.searchKbEntries('ns', project.id, { match: '"npm"', likeTerms: [] }, 5)).toHaveLength(0)
    expect(store.searchKbEntries('ns', project.id, { match: '"typecheck"', likeTerms: [] }, 5)).toHaveLength(1)
    store.removeKbEntry('ns', project.id, hit[0].id)
    expect(store.listKbEntries('ns', project.id)).toHaveLength(1)
    store.close()
  })

  it('LIKE 短词兜底命中两字符关键词', () => {
    const store = makeStore()
    const project = store.upsertProject('ns', { id: 'p-demo2', name: 'demo2', path: 'K:/demo2', color: 'calm' })
    store.saveKbEntry('ns', project.id, { title: 'uv', content: 'python 包管理用 uv 安装' })
    const hit = store.searchKbEntries('ns', project.id, { match: null, likeTerms: ['uv'] }, 5)
    expect(hit).toHaveLength(1)
    store.close()
  })

  it('删除项目时知识条目与 FTS 一并清理，rowid 复用不撞唯一键', () => {
    const store = makeStore()
    const project = store.upsertProject('ns', { id: 'p-demo3', name: 'demo3', path: 'K:/demo3', color: 'calm' })
    store.saveKbEntry('ns', project.id, { title: 'a', content: 'aaa' })
    store.removeProject('ns', project.id)
    expect(store.listKbEntries('ns', project.id)).toEqual([])
    // 新项目新条目：若 FTS 孤儿行还在，这里会抛 rowid 唯一键冲突
    const next = store.upsertProject('ns', { id: 'p-demo4', name: 'demo4', path: 'K:/demo4', color: 'calm' })
    expect(() => store.saveKbEntry('ns', next.id, { title: 'b', content: 'bbb' })).not.toThrow()
    store.close()
  })
})
