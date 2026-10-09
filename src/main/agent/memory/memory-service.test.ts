import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalStore } from '../../local-store'
import { createManualMemory, extractMemories, previewRecall, recallMemories } from './memory-service'

const defaultRoot = join(tmpdir(), 'fastagent-default')
mkdirSync(defaultRoot, { recursive: true })

vi.mock('electron', () => ({
  app: { getPath: () => defaultRoot },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

const roots: string[] = []
afterEach(() => { while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true }) })

function makeStore() {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-memory-'))
  roots.push(root)
  return new LocalStore(join(root, 'fastagent.db'))
}

const namespace = 'ns'

describe('recallMemories', () => {
  it('中文提问能召回同项目的中文记忆', () => {
    const store = makeStore()
    store.createMemory(namespace, { scope: 'workspace', scopeId: 'p1', type: 'decision', content: '当前项目数据库统一使用 PostgreSQL' })
    const result = recallMemories(store, { namespace, workspaceId: 'p1', text: '这个项目的数据库是什么' })
    expect(result.hits).toHaveLength(1)
    expect(result.prompt).toContain('PostgreSQL')
    expect(result.prompt).toContain('可能已过时')
    store.close()
  })

  it('两字符短词走 LIKE 兜底，同样能召回', () => {
    const store = makeStore()
    store.createMemory(namespace, { scope: 'global', scopeId: null, type: 'preference', content: '用户偏好使用 uv 管理依赖' })
    expect(recallMemories(store, { namespace, workspaceId: null, text: '依赖用 uv 还是 pip' }).hits).toHaveLength(1)
    store.close()
  })

  it('别的项目的记忆不会被召回', () => {
    const store = makeStore()
    store.createMemory(namespace, { scope: 'workspace', scopeId: 'p2', type: 'fact', content: '另一个项目数据库使用 MySQL' })
    expect(recallMemories(store, { namespace, workspaceId: 'p1', text: '数据库用什么' })).toMatchObject({ hits: [], prompt: '' })
    store.close()
  })

  it('没有可用查询词时不查库，直接返回空', () => {
    const store = makeStore()
    store.createMemory(namespace, { scope: 'global', scopeId: null, type: 'fact', content: '团队使用 pnpm' })
    const spy = vi.spyOn(store, 'searchMemories')
    expect(recallMemories(store, { namespace, workspaceId: null, text: '好的' }).hits).toEqual([])
    expect(spy).not.toHaveBeenCalled()
    store.close()
  })

  it('召回条数受 maxRecall 约束，并记录访问时间', () => {
    const store = makeStore()
    for (let index = 0; index < 6; index += 1) {
      store.createMemory(namespace, { scope: 'global', scopeId: null, type: 'fact', content: `数据库分片规则第 ${index} 条` })
    }
    const result = recallMemories(store, { namespace, workspaceId: null, text: '数据库分片规则', maxRecall: 3 })
    expect(result.hits).toHaveLength(3)
    expect(store.getMemory(namespace, result.hits[0].memory.id)?.lastAccessedAt).toBeTypeOf('number')
    store.close()
  })
})

describe('extractMemories', () => {
  const input = {
    namespace, conversationId: 'c1', turnId: 't1', runId: 'r1', workspaceId: 'p1',
    userText: '本项目以后统一改成 PostgreSQL', assistantText: '好的，已按 PostgreSQL 调整'
  }

  it('无信息量的回合不调用模型', async () => {
    const store = makeStore()
    const runModel = vi.fn()
    await extractMemories(store, runModel, { ...input, userText: '好的' })
    expect(runModel).not.toHaveBeenCalled()
    store.close()
  })

  it('抽取结果落库，来源信息可追溯', async () => {
    const store = makeStore()
    const result = await extractMemories(store, async () => '- [decision|workspace|4] 当前项目数据库统一使用 PostgreSQL', input)
    expect(result.created).toHaveLength(1)
    expect(result.created[0]).toMatchObject({ scope: 'workspace', scopeId: 'p1', sourceConversationId: 'c1', sourceTurnId: 't1', sourceRunId: 'r1' })
    store.close()
  })

  it('模型声明替代时旧记忆失效', async () => {
    const store = makeStore()
    const old = store.createMemory(namespace, { scope: 'workspace', scopeId: 'p1', type: 'decision', content: '当前项目数据库统一使用 MySQL' })
    const result = await extractMemories(store, async () => '- [decision|workspace|4] 当前项目数据库统一使用 PostgreSQL <替代:1>', input)
    expect(result.supersededIds).toEqual([old.id])
    expect(store.getMemory(namespace, old.id)?.status).toBe('superseded')
    expect(store.searchMemories(namespace, { match: '"数据库"', workspaceId: 'p1' })).toHaveLength(1)
    store.close()
  })

  it('重复抽取只刷新，不产生第二条', async () => {
    const store = makeStore()
    const existing = store.createMemory(namespace, { scope: 'workspace', scopeId: 'p1', type: 'decision', content: '当前项目数据库统一使用 PostgreSQL', importance: 2 })
    const result = await extractMemories(store, async () => '- [decision|workspace|5] 当前项目数据库统一使用 PostgreSQL', input)
    expect(result.created).toEqual([])
    expect(result.refreshedIds).toEqual([existing.id])
    expect(store.getMemory(namespace, existing.id)?.importance).toBe(5)
    store.close()
  })

  it('模型输出 NONE 时不写库', async () => {
    const store = makeStore()
    const result = await extractMemories(store, async () => 'NONE', input)
    expect(result.created).toEqual([])
    expect(store.countMemories(namespace)).toBe(0)
    store.close()
  })

  it('疑似凭据的内容被丢弃', async () => {
    const store = makeStore()
    const result = await extractMemories(store, async () => '- [fact|global|3] 部署用的 api_key: abcd1234efgh', input)
    expect(result.created).toEqual([])
    store.close()
  })

  it('未归属项目时抽取结果落到 global', async () => {
    const store = makeStore()
    const result = await extractMemories(store, async () => '- [fact|workspace|3] 团队统一使用 pnpm 管理依赖', { ...input, workspaceId: null })
    expect(result.created[0]).toMatchObject({ scope: 'global', scopeId: null })
    store.close()
  })
})

describe('previewRecall', () => {
  const on = { enabled: true, maxRecall: 5 }

  it('按当前设置返回会注入的记忆与知识条目，但不刷新记忆访问时间', () => {
    const store = makeStore()
    const memory = store.createMemory(namespace, { scope: 'workspace', scopeId: 'p1', type: 'decision', content: '当前项目数据库统一使用 PostgreSQL' })
    store.saveKbEntry(namespace, 'p1', { title: '数据库约定', content: '数据库迁移脚本放在 migrations 目录' })
    const result = previewRecall(store, { namespace, projectId: 'p1', text: '这个项目的数据库是什么', memory: on, knowledge: on })
    expect(result.memories.map((item) => item.id)).toEqual([memory.id])
    expect(result.knowledge.map((item) => item.title)).toEqual(['数据库约定'])
    expect(store.getMemory(namespace, memory.id)?.lastAccessedAt).toBeNull()
    store.close()
  })

  it('开关关着时如实返回空，并标出是哪一路关了', () => {
    const store = makeStore()
    store.createMemory(namespace, { scope: 'global', scopeId: null, type: 'preference', content: '回答使用中文数据库术语' })
    store.saveKbEntry(namespace, 'p1', { title: '数据库约定', content: '数据库迁移脚本放在 migrations 目录' })
    const result = previewRecall(store, { namespace, projectId: 'p1', text: '数据库', memory: { enabled: false, maxRecall: 5 }, knowledge: { enabled: false, maxRecall: 3 } })
    expect(result).toEqual({ memories: [], knowledge: [], memoryEnabled: false, knowledgeEnabled: false })
    store.close()
  })

  it('未归属项目时只查全局记忆，不查知识库', () => {
    const store = makeStore()
    store.createMemory(namespace, { scope: 'global', scopeId: null, type: 'preference', content: '数据库命名使用蛇形' })
    store.saveKbEntry(namespace, 'p1', { title: '数据库约定', content: '数据库迁移脚本放在 migrations 目录' })
    const result = previewRecall(store, { namespace, projectId: null, text: '数据库命名', memory: on, knowledge: on })
    expect(result.memories).toHaveLength(1)
    expect(result.knowledge).toEqual([])
    store.close()
  })
})

describe('createManualMemory', () => {
  it('手动记忆去首尾空白，重要性与置信度高于自动抽取', () => {
    const store = makeStore()
    const memory = createManualMemory(store, namespace, { content: '  提交信息用中文  ', type: 'preference', scope: 'global', scopeId: 'ignored' })
    expect(memory).toMatchObject({ content: '提交信息用中文', scope: 'global', scopeId: null, importance: 4, confidence: 1, sourceConversationId: null })
    store.close()
  })

  it('空内容、超长内容与缺项目的项目记忆直接拒绝', () => {
    const store = makeStore()
    expect(() => createManualMemory(store, namespace, { content: '   ', type: 'fact', scope: 'global', scopeId: null })).toThrow('不能为空')
    expect(() => createManualMemory(store, namespace, { content: '长'.repeat(501), type: 'fact', scope: 'global', scopeId: null })).toThrow('不能超过')
    expect(() => createManualMemory(store, namespace, { content: '用 pnpm', type: 'fact', scope: 'workspace', scopeId: null })).toThrow('需要指定项目')
    store.close()
  })
})
