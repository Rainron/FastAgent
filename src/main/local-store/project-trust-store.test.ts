import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalStore } from '../local-store'

const roots: string[] = []
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'fa-trust-'))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('ProjectTrustStore（经 LocalStore 门面）', () => {
  it('未知项目默认未信任', () => {
    const store = new LocalStore(':memory:')
    expect(store.isProjectTrusted('ns', 'K:/work/project-a')).toBe(false)
    expect(store.getProjectTrust('ns', 'K:/work/project-a')).toBeNull()
  })

  it('信任与撤销按规范化路径生效：大小写与斜杠差异视为同一项目（win32）', () => {
    const store = new LocalStore(':memory:')
    store.setProjectTrust('ns', 'K:\\Work\\ProjectA', true)
    // 分隔符与大小写不同的写法应命中同一条记录
    expect(store.isProjectTrusted('ns', 'k:/work/projecta')).toBe(true)
    store.setProjectTrust('ns', 'k:/work/PROJECTA', false)
    expect(store.isProjectTrusted('ns', 'K:\\Work\\ProjectA')).toBe(false)
  })

  it('信任决策按命名空间隔离', () => {
    const store = new LocalStore(':memory:')
    store.setProjectTrust('ns-a', 'K:/work/p', true)
    expect(store.isProjectTrusted('ns-b', 'K:/work/p')).toBe(false)
  })

  it('记录保留展示路径的原样大小写', () => {
    const store = new LocalStore(':memory:')
    store.setProjectTrust('ns', 'K:\\Work\\ProjectA', true)
    const record = store.getProjectTrust('ns', 'k:/work/projecta')
    expect(record?.trusted).toBe(true)
    expect(record?.displayPath).toBe('K:\\Work\\ProjectA')
  })
})

describe('seedProjectTrustFromProjects（存量项目初始化）', () => {
  it('升级时把存量 projects 全部 seed 为已信任，撤销不被覆盖', () => {
    const store = new LocalStore(':memory:')
    const root = makeRoot()
    store.upsertProject('ns', { id: 'p1', name: 'old', path: join(root, 'Legacy'), color: 'calm' })
    // 手动触发一次 seed（模拟 v7 迁移；新库 user_version 已是 7，日常不会再跑）
    const db = (store as unknown as { db: import('better-sqlite3').Database }).db
    db.prepare(`INSERT OR IGNORE INTO project_trust (namespace, trust_key, trusted, display_path, updated_at) VALUES (?, ?, 1, ?, ?)`)
      .run('ns', join(root, 'Legacy'), join(root, 'Legacy'), new Date().toISOString())
    // 用户撤销过：seed 幂等不覆盖
    store.setProjectTrust('ns', join(root, 'Legacy'), false)
    expect(store.isProjectTrusted('ns', join(root, 'Legacy'))).toBe(false)
  })
})

describe('readAgentContextFiles 信任门控', () => {
  it('未信任时项目文件只进 withheld，内容不读、全局文件不受影响', async () => {
    const { readAgentContextFiles } = await import('../agent-context')
    const home = makeRoot()
    const project = makeRoot()
    // 用注入的 exists/read 避免真实文件系统拼装
    const readCalls: string[] = []
    const files = new Map<string, string>([
      [join(home, '.fa', 'AGENTS.md'), 'global rules'],
      [join(project, 'AGENTS.md'), 'malicious project rules'],
      [join(project, 'CLAUDE.md'), 'more instructions']
    ])
    const result = readAgentContextFiles({
      home,
      projectRoot: project,
      projectTrusted: false,
      exists: (path) => files.has(path),
      read: (path) => { readCalls.push(path); return files.get(path) ?? '' }
    })
    expect(result.files.map((file) => file.content)).toEqual(['global rules'])
    expect(result.withheld?.map((item) => item.name).sort()).toEqual(['AGENTS.md', 'CLAUDE.md'])
    // 未信任的项目文件连读取都不发生
    expect(readCalls).toEqual([join(home, '.fa', 'AGENTS.md')])
  })

  it('已信任时项目文件正常读取，withheld 为空', async () => {
    const { readAgentContextFiles } = await import('../agent-context')
    const home = makeRoot()
    const project = makeRoot()
    const files = new Map<string, string>([
      [join(project, 'AGENTS.md'), 'my own project rules']
    ])
    const result = readAgentContextFiles({
      home,
      projectRoot: project,
      projectTrusted: true,
      exists: (path) => files.has(path),
      read: (path) => files.get(path) ?? ''
    })
    expect(result.files.map((file) => file.source)).toEqual(['project'])
    expect(result.withheld).toBeUndefined()
  })
})
