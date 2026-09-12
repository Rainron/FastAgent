import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalStore } from './local-store'
import * as schema from './local-store/schema'
import type { ConversationTurn } from '../shared/types'

const defaultRoot = join(tmpdir(), 'fastagent-default')
mkdirSync(defaultRoot, { recursive: true })

/**
 * 一次性迁移按 user_version 门控，用当前版本的 LocalStore 播种出来的库已经被打上版本号。
 * 把版本抹回 0，才是「升级前留下的旧库」这个被测场景。
 */
function markLegacySchema(databasePath: string) {
  const raw = new Database(databasePath)
  raw.pragma('user_version = 0')
  raw.close()
}

const encryption = vi.hoisted(() => ({ available: false }))

vi.mock('electron', () => ({
  app: { getPath: () => defaultRoot },
  safeStorage: {
    isEncryptionAvailable: () => encryption.available,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').slice('enc:'.length)
  }
}))

const tempRoots: string[] = []

afterEach(() => {
  encryption.available = false
  while (tempRoots.length) rmSync(tempRoots.pop() as string, { recursive: true, force: true })
})

function makeStore() {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-store-'))
  tempRoots.push(root)
  return new LocalStore(join(root, 'fastagent.db'))
}

describe('LocalStore Hub 源', () => {
  it('保存后读回，未提供 apiKey 时 hasSecrets 为假', () => {
    const store = makeStore()
    const saved = store.saveHubSource({ id: 'team', kind: 'git', name: '团队源', url: 'https://github.com/acme/kit', enabled: true })
    expect(saved).toMatchObject({ id: 'team', kind: 'git', name: '团队源', enabled: true, hasSecrets: false, status: 'untested' })
    store.close()
  })

  it('apiKey 加密落 secrets 列，只回传 hasSecrets', () => {
    encryption.available = true
    const store = makeStore()
    const saved = store.saveHubSource({ id: 's', kind: 'skillsmp', name: 'SkillsMP', enabled: true, apiKey: 'k-123456' })
    expect(saved.hasSecrets).toBe(true)
    expect(JSON.stringify(saved)).not.toContain('k-123456')
    expect(store.getHubSourceApiKey('s')).toBe('k-123456')
    store.close()
  })

  it('再次保存不传 apiKey 时保留原密钥', () => {
    encryption.available = true
    const store = makeStore()
    store.saveHubSource({ id: 's', kind: 'skillsmp', name: 'SkillsMP', enabled: true, apiKey: 'k-1' })
    store.saveHubSource({ id: 's', kind: 'skillsmp', name: '改名了', enabled: false })
    expect(store.getHubSourceApiKey('s')).toBe('k-1')
    expect(store.listHubSources()[0]).toMatchObject({ name: '改名了', enabled: false })
    store.close()
  })

  it('传空串等于清除密钥', () => {
    encryption.available = true
    const store = makeStore()
    store.saveHubSource({ id: 's', kind: 'skillsmp', name: 'SkillsMP', enabled: true, apiKey: 'k-1' })
    store.saveHubSource({ id: 's', kind: 'skillsmp', name: 'SkillsMP', enabled: true, apiKey: '' })
    expect(store.getHubSourceApiKey('s')).toBeNull()
    store.close()
  })

  it('按 sortOrder 排序，删除后不再列出', () => {
    const store = makeStore()
    store.saveHubSource({ id: 'b', kind: 'git', name: 'B', enabled: true, sortOrder: 2 })
    store.saveHubSource({ id: 'a', kind: 'git', name: 'A', enabled: true, sortOrder: 1 })
    expect(store.listHubSources().map((source) => source.id)).toEqual(['a', 'b'])
    store.removeHubSource('a')
    expect(store.listHubSources().map((source) => source.id)).toEqual(['b'])
    store.close()
  })
})

describe('LocalStore MCP 工具开关', () => {
  it('缺行即启用，只记被禁用的工具', () => {
    const store = makeStore()
    expect(store.listDisabledMcpTools('srv')).toEqual([])
    store.setMcpToolEnabled('srv', 'deploy', false)
    store.setMcpToolEnabled('srv', 'read', true)
    expect(store.listDisabledMcpTools('srv')).toEqual(['deploy'])
    store.close()
  })

  it('重新启用后从禁用清单里消失', () => {
    const store = makeStore()
    store.setMcpToolEnabled('srv', 'deploy', false)
    store.setMcpToolEnabled('srv', 'deploy', true)
    expect(store.listDisabledMcpTools('srv')).toEqual([])
    store.close()
  })

  it('按 Server 清除工具状态', () => {
    const store = makeStore()
    store.setMcpToolEnabled('a', 'x', false)
    store.setMcpToolEnabled('b', 'y', false)
    store.removeMcpToolState('a')
    expect(store.listAllDisabledMcpTools()).toEqual([{ serverId: 'b', toolName: 'y' }])
    store.close()
  })
})

describe('LocalStore CLI 工具', () => {
  const tool = { id: 'gh', name: 'GitHub CLI', executable: 'gh', versionArgs: ['--version'], allowPatterns: ['gh *'], enabled: false }

  it('保存后读回', () => {
    const store = makeStore()
    expect(store.saveCliTool(tool)).toMatchObject(tool)
    expect(store.listCliTools()).toHaveLength(1)
    store.close()
  })

  it('探测结果单独存，保存工具本身不清掉它', () => {
    const store = makeStore()
    store.saveCliTool(tool)
    store.setCliToolCheck('gh', { checkedAt: '2026-09-03T00:00:00.000Z', ok: true, version: 'gh 2.0.0' })
    store.saveCliTool({ ...tool, enabled: true })
    expect(store.getCliToolCheck('gh')).toMatchObject({ ok: true, version: 'gh 2.0.0' })
    store.close()
  })

  it('没有探测结果时返回 null，不进汇总列表', () => {
    const store = makeStore()
    store.saveCliTool(tool)
    expect(store.getCliToolCheck('gh')).toBeNull()
    expect(store.listCliToolChecks()).toEqual([])
    store.close()
  })

  it('删除后不再列出', () => {
    const store = makeStore()
    store.saveCliTool(tool)
    store.removeCliTool('gh')
    expect(store.listCliTools()).toEqual([])
    store.close()
  })
})

describe('LocalStore conversations', () => {
  it('persists a complete turn and updates it as one unit', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'turns', title: 'Turns' })
    const turn = store.createTurn('account-a', 'turns', {
      userMessage: { text: '检查项目', createdAt: '2026-08-30T10:01:00.000Z' },
      attachments: [{ id: 'a1', name: 'README.md', type: 'text/markdown', size: 10 }],
      runtimeConfig: { modelId: 5, thinkingLevel: 'high', mode: 'agent', permission: 'workspace', project: 'demo' },
      status: 'working',
      createdAt: '2026-08-30T10:01:00.000Z'
    })
    expect(turn.userMessage.text).toBe('检查项目')
    expect(turn.attachments[0].name).toBe('README.md')

    const updated = store.updateTurn('account-a', turn.id, {
      assistantMessage: { text: '检查完成', createdAt: '2026-08-30T10:02:00.000Z' },
      status: 'completed'
    })
    expect(updated?.assistantMessage?.text).toBe('检查完成')
    expect(updated?.status).toBe('completed')
    expect(store.listTurns('account-a', 'turns')).toHaveLength(1)
    store.close()
  })

  it('传入已读到的 turn 时，落库与返回值都与重新读一遍等价', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'turns', title: 'Turns' })
    const execution = { runId: 'r1', status: 'running' as const, steps: [], events: [], activeStepId: 'step-1', activeEventId: null, activeThinkingId: null }
    const turn = store.createTurn('account-a', 'turns', {
      userMessage: { text: '跑一轮', createdAt: '2026-09-04T10:01:00.000Z' },
      runtimeConfig: { modelId: 5, thinkingLevel: 'high', mode: 'agent', permission: 'workspace', project: 'demo' },
      activity: { status: 'working', startedAt: '2026-09-04T10:01:00.000Z', finishedAt: null, events: [], execution },
      status: 'working'
    })

    const patch = { activity: { status: 'done' as const, startedAt: '2026-09-04T10:01:00.000Z', finishedAt: '2026-09-04T10:02:00.000Z', events: [], execution }, status: 'completed' as const }
    const returned = store.updateTurn('account-a', turn.id, patch, turn)
    // 终态轮次的执行快照要被归一化：这一步过去由「写完再读回」顺带完成
    expect(returned?.activity?.execution?.status).toBe('completed')
    expect(returned?.activity?.execution?.activeStepId).toBeNull()
    expect(returned).toEqual(store.getTurn('account-a', turn.id))

    // 传进来的 turn 不是这一轮时忽略它，回退到按 id 读
    const other = store.createTurn('account-a', 'turns', { userMessage: { text: '另一轮', createdAt: '2026-09-04T10:03:00.000Z' } })
    const guarded = store.updateTurn('account-a', turn.id, { status: 'failed' }, other)
    expect(guarded?.id).toBe(turn.id)
    expect(guarded?.userMessage.text).toBe('跑一轮')
    store.close()
  })

  it('deletes and restores exactly one turn without touching other turns', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'turns', title: 'Turns' })
    const first = store.createTurn('account-a', 'turns', { userMessage: { text: '第一轮', createdAt: '2026-08-30T10:01:00.000Z' } })
    const second = store.createTurn('account-a', 'turns', { userMessage: { text: '第二轮', createdAt: '2026-08-30T10:03:00.000Z' } })
    const removed = store.deleteTurn('account-a', first.id)
    expect(removed?.id).toBe(first.id)
    expect(store.listTurns('account-a', 'turns').map((item) => item.id)).toEqual([second.id])
    expect(store.restoreTurn('account-a', removed as ConversationTurn).id).toBe(first.id)
    expect(store.listTurns('account-a', 'turns').map((item) => item.userMessage.text)).toEqual(['第一轮', '第二轮'])
    store.close()
  })

  it('migrates legacy user and assistant messages into turns', () => {
    const root = mkdtempSync(join(tmpdir(), 'fastagent-store-'))
    tempRoots.push(root)
    const databasePath = join(root, 'fastagent.db')
    const legacy = new LocalStore(databasePath)
    legacy.createConversation('account-a', { id: 'legacy', title: 'Legacy' })
    legacy.appendMessage('account-a', 'legacy', { role: 'user', text: '旧问题', createdAt: '2026-08-30T10:01:00.000Z' }, '00000000-0000-0000-0000-000000000001')
    legacy.appendMessage('account-a', 'legacy', { role: 'assistant', text: '旧回答', createdAt: '2026-08-30T10:02:00.000Z' }, '00000000-0000-0000-0000-000000000002')
    legacy.close()
    markLegacySchema(databasePath)

    const store = new LocalStore(databasePath)
    const turns = store.listTurns('account-a', 'legacy')
    expect(turns).toHaveLength(1)
    expect(turns[0].userMessage.text).toBe('旧问题')
    expect(turns[0].assistantMessage?.text).toBe('旧回答')
    store.close()
  })

  it('清掉历史 activity 事件里的重复 execution 快照，保留顶层快照', () => {
    const root = mkdtempSync(join(tmpdir(), 'fastagent-store-'))
    tempRoots.push(root)
    const databasePath = join(root, 'fastagent.db')
    const execution = { runId: 'r1', status: 'completed' as const, steps: [], events: [], activeStepId: null, activeEventId: null, activeThinkingId: null }
    const legacy = new LocalStore(databasePath)
    legacy.createConversation('account-a', { id: '历史', title: '历史会话' })
    const turn = legacy.createTurn('account-a', '历史', {
      userMessage: { text: '跑一轮', createdAt: '2026-09-02T10:01:00.000Z' },
      runtimeConfig: { modelId: 1, thinkingLevel: 'auto', mode: 'agent', permission: 'workspace', project: null },
      activity: {
        status: 'done',
        startedAt: '2026-09-02T10:01:00.000Z',
        finishedAt: '2026-09-02T10:02:00.000Z',
        thinking: '想了想',
        execution,
        events: [
          { runId: 'r1', type: 'tool_started', tool: 'read', timestamp: 1000, execution },
          { runId: 'r1', type: 'completed', text: '好了', timestamp: 2000, execution }
        ]
      }
    })
    legacy.close()
    // 只把版本抹回 2：这次要验的是新增的那一档迁移，不是把旧档全跑一遍。
    const raw = new Database(databasePath)
    raw.pragma('user_version = 2')
    raw.close()

    const store = new LocalStore(databasePath)
    const migrated = store.getTurn('account-a', turn.id)
    expect(migrated?.activity?.events.every((event) => !('execution' in event))).toBe(true)
    expect(migrated?.activity?.events[1]).toMatchObject({ type: 'completed', text: '好了' })
    expect(migrated?.activity?.execution).toMatchObject({ runId: 'r1' })
    expect(migrated?.activity?.thinking).toBe('想了想')
    store.close()
  })

  it('把历史回合里的 file_changed 事件补登记成 Artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'fastagent-store-'))
    tempRoots.push(root)
    const databasePath = join(root, 'fastagent.db')
    const project = 'K:\\cc-project\\demo'
    const legacy = new LocalStore(databasePath)
    legacy.createConversation('account-a', { id: '历史', title: '历史会话' })
    const turn = legacy.createTurn('account-a', '历史', {
      userMessage: { text: '写点文档', createdAt: '2026-08-30T10:01:00.000Z' },
      runtimeConfig: { modelId: 1, thinkingLevel: 'auto', mode: 'agent', permission: 'workspace', project },
      activity: {
        status: 'done',
        startedAt: '2026-08-30T10:01:00.000Z',
        finishedAt: '2026-08-30T10:02:00.000Z',
        events: [
          // 绝对路径正是此前被静默丢掉的形态
          { runId: 'r1', type: 'file_changed', path: 'K:/cc-project/demo/docs/a.md', detail: 'write', timestamp: 1000 },
          { runId: 'r1', type: 'file_changed', path: 'K:/cc-project/demo/docs/a.md', detail: 'edit', timestamp: 2000 },
          // 工作区外的临时文件不是产物
          { runId: 'r1', type: 'file_changed', path: 'C:/Temp/scratch.ps1', detail: 'write', timestamp: 1500 }
        ]
      }
    })
    legacy.close()
    markLegacySchema(databasePath)

    const store = new LocalStore(databasePath)
    const artifacts = store.listArtifacts('account-a', { workspaceId: project })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      path: 'docs/a.md',
      name: 'a.md',
      type: 'markdown',
      conversationId: '历史',
      turnId: turn.id,
      // 最近一次写入的工具与时间
      source: 'edit',
      createdAt: 1000,
      updatedAt: 2000
    })
    store.close()

    // 再开一次不会重复回填（user_version 已经抬到当前版本）
    const reopened = new LocalStore(databasePath)
    expect(reopened.listArtifacts('account-a', { workspaceId: project })).toHaveLength(1)
    reopened.close()
  })

  it('latestTurnRuntime 与 listTurns 末项一致，空会话返回 null', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'latest', title: 'Latest' })
    expect(store.latestTurnRuntime('account-a', 'latest')).toBeNull()
    store.createTurn('account-a', 'latest', {
      userMessage: { text: '第一轮', createdAt: '2026-08-30T10:01:00.000Z' },
      runtimeConfig: { modelId: 7, thinkingLevel: 'low', mode: 'chat', permission: 'ask', project: null }
    })
    store.createTurn('account-a', 'latest', {
      userMessage: { text: '第二轮', createdAt: '2026-08-30T10:03:00.000Z' },
      runtimeConfig: { modelId: 9, thinkingLevel: 'high', mode: 'agent', permission: 'workspace', project: null },
      status: 'completed'
    })
    const turns = store.listTurns('account-a', 'latest')
    const latest = store.latestTurnRuntime('account-a', 'latest')
    expect(latest?.runtimeConfig).toEqual(turns.at(-1)?.runtimeConfig)
    expect(latest?.status).toBe(turns.at(-1)?.status)
    expect(latest?.runtimeConfig.modelId).toBe(9)
    store.close()
  })

  it('latestTurnRuntime 同样把退役的 code 模式归一为 agent', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'legacy-mode', title: 'Legacy' })
    store.createTurn('account-a', 'legacy-mode', {
      userMessage: { text: '旧模式', createdAt: '2026-08-30T10:01:00.000Z' },
      runtimeConfig: { mode: 'code' as unknown as ConversationTurn['runtimeConfig']['mode'] }
    })
    expect(store.latestTurnRuntime('account-a', 'legacy-mode')?.runtimeConfig.mode).toBe('agent')
    store.close()
  })

  it('会话绑定模型可读写，且优先于末轮记录', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'bind', title: 'Bind' })
    expect(store.getConversationModelId('account-a', 'bind')).toBeNull()

    store.createTurn('account-a', 'bind', { userMessage: { text: '你好', createdAt: '2026-08-30T10:00:00.000Z' }, runtimeConfig: { modelId: 7, thinkingLevel: 'auto', mode: 'chat', permission: null, project: null }, status: 'completed' })
    expect(store.getConversationDetailed('account-a', 'bind')?.runtime.modelId).toBe(7)

    store.setConversationModelId('account-a', 'bind', 9)
    expect(store.getConversationModelId('account-a', 'bind')).toBe(9)
    expect(store.getConversation('account-a', 'bind')?.modelId).toBe(9)
    expect(store.getConversationDetailed('account-a', 'bind')?.runtime.modelId).toBe(9)
    store.close()
  })

  it('provider 运行记录按 provider 判定，不区分同 provider 下的不同模型', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'provider', title: 'Provider' })
    const context = { conversationId: 'provider', contextWindow: 128_000, estimatedTokens: 10, messageTokens: 10, toolTokens: 0, systemTokens: 0, compactionCount: 0, latestSummaryId: null, updatedAt: '2026-08-30T10:00:00.000Z' }
    store.upsertModelRuntime('account-a', { conversationId: 'provider', provider: 'anthropic', modelId: 1, context })

    expect(store.hasProviderRuntime('account-a', 'provider', 'anthropic')).toBe(true)
    expect(store.hasProviderRuntime('account-a', 'provider', 'openai')).toBe(false)
    store.close()
  })

  it('旧库按模型分桶的 session 迁移为会话级，取最近更新的一份', () => {
    const root = mkdtempSync(join(tmpdir(), 'fastagent-store-'))
    tempRoots.push(root)
    const path = join(root, 'fastagent.db')
    const seed = new LocalStore(path)
    seed.createConversation('account-a', { id: 'migrate', title: 'Migrate' })
    const context = { conversationId: 'migrate', contextWindow: 128_000, estimatedTokens: 10, messageTokens: 10, toolTokens: 0, systemTokens: 0, compactionCount: 0, latestSummaryId: null, updatedAt: '2026-08-30T10:00:00.000Z' }
    seed.upsertModelRuntime('account-a', { conversationId: 'migrate', provider: 'anthropic', modelId: 1, context })
    seed.setModelRuntimeSessionFile('account-a', 'migrate', 'anthropic', 1, '/sessions/old.jsonl')
    seed.upsertModelRuntime('account-a', { conversationId: 'migrate', provider: 'openai', modelId: 2, context })
    seed.setModelRuntimeSessionFile('account-a', 'migrate', 'openai', 2, '/sessions/new.jsonl')
    expect(seed.getConversationSessionFile('account-a', 'migrate')).toBeNull()
    seed.close()
    markLegacySchema(path)

    const reopened = new LocalStore(path)
    expect(reopened.getConversationSessionFile('account-a', 'migrate')).toBe('/sessions/new.jsonl')
    reopened.close()
  })

  it('creates conversations and orders them by latest activity', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'c1', title: '旧会话', createdAt: '2026-08-30T10:00:00.000Z' })
    store.createConversation('account-a', { id: 'c2', title: '新会话', createdAt: '2026-08-30T11:00:00.000Z' })

    expect(store.listConversations('account-a')).toEqual([
      { id: 'c2', title: '新会话', createdAt: '2026-08-30T11:00:00.000Z', updatedAt: '2026-08-30T11:00:00.000Z', archived: false, projectId: null, modelId: null },
      { id: 'c1', title: '旧会话', createdAt: '2026-08-30T10:00:00.000Z', updatedAt: '2026-08-30T10:00:00.000Z', archived: false, projectId: null, modelId: null }
    ])
    store.close()
  })

  it('keeps the conversation project binding across reads', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'p1', title: '项目会话', projectId: 'project-1' })
    store.createConversation('account-a', { id: 'p0', title: '无项目会话' })

    expect(store.getConversation('account-a', 'p1')?.projectId).toBe('project-1')
    expect(store.getConversation('account-a', 'p0')?.projectId).toBeNull()
    const listed = store.listConversations('account-a')
    expect(listed.find((item) => item.id === 'p1')?.projectId).toBe('project-1')
    expect(listed.find((item) => item.id === 'p0')?.projectId).toBeNull()
    store.close()
  })

  it('resolves the run cwd from the conversation project only', () => {
    const store = makeStore()
    store.upsertProject('account-a', { id: 'project-1', name: 'demo', path: 'K:\\code\\demo', color: 'calm' })
    store.createConversation('account-a', { id: 'p1', title: '项目会话', projectId: 'project-1' })
    store.createConversation('account-a', { id: 'p0', title: '无项目会话' })
    store.createConversation('account-b', { id: 'p1', title: '同名会话', projectId: 'project-1' })

    expect(store.getConversationRoot('account-a', 'p1')).toBe('K:\\code\\demo')
    expect(store.getConversationRoot('account-a', 'p0')).toBeNull()
    // 项目表按 namespace 隔离：别的账号有同名 project_id 也不会串出目录
    expect(store.getConversationRoot('account-b', 'p1')).toBeNull()
    expect(store.getConversationRoot('account-a', 'missing')).toBeNull()
    store.close()
  })

  it('stores history, archives it, and keeps namespaces isolated', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'same-id', title: 'A', createdAt: '2026-08-30T10:00:00.000Z' })
    store.createConversation('account-b', { id: 'same-id', title: 'B', createdAt: '2026-08-30T10:00:00.000Z' })
    store.appendMessage('account-a', 'same-id', { role: 'user', text: '你好', createdAt: '2026-08-30T10:01:00.000Z' })
    store.appendMessage('account-a', 'same-id', { role: 'assistant', text: '你好！', createdAt: '2026-08-30T10:02:00.000Z' })

    expect(store.listMessages('account-a', 'same-id')).toEqual([
      { role: 'user', text: '你好', createdAt: '2026-08-30T10:01:00.000Z' },
      { role: 'assistant', text: '你好！', createdAt: '2026-08-30T10:02:00.000Z' }
    ])
    expect(store.listMessages('account-b', 'same-id')).toEqual([])

    store.archiveConversation('account-a', 'same-id')
    expect(store.listConversations('account-a')).toEqual([])
    expect(store.listConversations('account-a', true)[0].archived).toBe(true)
    store.removeConversation('account-a', 'same-id')
    expect(store.listMessages('account-a', 'same-id')).toEqual([])
    store.close()
  })

  it('clears all turns and runtime state but keeps the conversation entry', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'wipe', title: '要清空', createdAt: '2026-08-30T10:00:00.000Z' })
    store.createTurn('account-a', 'wipe', { userMessage: { text: '第一轮', createdAt: '2026-08-30T10:01:00.000Z' } })
    store.createTurn('account-a', 'wipe', { userMessage: { text: '第二轮', createdAt: '2026-08-30T10:02:00.000Z' } })
    store.setTodos('account-a', 'wipe', [{ id: 't1', content: '待办', status: 'in_progress', position: 0 }])
    store.appendMessage('account-a', 'wipe', { role: 'user', text: '旧遗留消息', createdAt: '2026-08-30T10:03:00.000Z' })

    expect(store.clearConversationTurns('account-a', 'wipe')).toBe(2)
    expect(store.listTurns('account-a', 'wipe')).toEqual([])
    expect(store.listTodos('account-a', 'wipe')).toEqual([])
    expect(store.listMessages('account-a', 'wipe')).toEqual([])
    const kept = store.getConversation('account-a', 'wipe')
    expect(kept).not.toBeNull()
    expect(kept?.title).toBe('新对话')
    store.close()
  })

  it('keeps conversations and history after reopening the database', () => {
    const root = mkdtempSync(join(tmpdir(), 'fastagent-store-reopen-'))
    tempRoots.push(root)
    const path = join(root, 'fastagent.db')
    const first = new LocalStore(path)
    first.createConversation('account-a', { id: 'restart', title: '重启后仍在', createdAt: '2026-08-30T12:00:00.000Z' })
    first.appendMessage('account-a', 'restart', { role: 'user', text: '保留这条', createdAt: '2026-08-30T12:01:00.000Z' })
    first.close()

    const reopened = new LocalStore(path)
    expect(reopened.listConversations('account-a')[0].title).toBe('重启后仍在')
    expect(reopened.listMessages('account-a', 'restart')[0].text).toBe('保留这条')
    reopened.close()
  })

  it('persists global settings and merges partial updates', () => {
    const store = makeStore()
    expect(store.getSettings().theme).toBe('system')
    const next = store.updateSettings({ theme: 'dark', triggerRatio: 0.82 })
    expect(next).toMatchObject({ theme: 'dark', triggerRatio: 0.82, autoSummary: true })
    store.close()
  })

  it('持久化本地 MCP 配置并默认隐藏密钥内容', () => {
    const store = makeStore()
    const saved = store.saveMcpServer({ id: 'docs', name: 'Docs', transport: 'stdio', command: 'node', args: ['server.js'], enabled: true, timeoutMs: 5000 })
    expect(saved).toMatchObject({ id: 'docs', enabled: true, hasSecrets: false })
    expect(store.listMcpServers()).toHaveLength(1)
    expect(store.listEnabledMcpRuntimeConfigs()[0]).toMatchObject({ command: 'node', env: {}, headers: {} })
    expect(() => store.saveMcpServer({ id: 'secret', name: 'Secret', transport: 'streamable_http', url: 'https://mcp.example', enabled: true, timeoutMs: 5000, headers: { Authorization: 'Bearer secret' } })).toThrow('系统加密')
    store.removeMcpServer('docs')
    expect(store.listMcpServers()).toEqual([])
    store.close()
  })

  it('持久化本地 Skill 的显式启用状态', () => {
    const store = makeStore()
    expect(store.isSkillEnabled('review')).toBe(false)
    store.setSkillEnabled('review', true)
    expect(store.isSkillEnabled('review')).toBe(true)
    store.removeSkillState('review')
    expect(store.isSkillEnabled('review')).toBe(false)
    store.close()
  })

  it('将全局偏好与账户模型偏好分开持久化', () => {
    const store = makeStore()
    store.updateClientPreferences(null, { recentServers: ['https://agent.example'], modePrompts: { agent: '谨慎执行' } })
    store.updateClientPreferences('account-a', { favoriteModelIds: [7], recentModelIds: [9, 7], selectedModelId: -3 })
    store.updateClientPreferences('account-b', { favoriteModelIds: [8] })

    expect(store.getClientPreferences(null)).toMatchObject({ recentServers: ['https://agent.example'], modePrompts: { agent: '谨慎执行' }, favoriteModelIds: [], recentModelIds: [] })
    expect(store.getClientPreferences('account-a')).toMatchObject({ recentServers: ['https://agent.example'], favoriteModelIds: [7], recentModelIds: [9, 7], selectedModelId: -3 })
    expect(store.getClientPreferences('account-b').favoriteModelIds).toEqual([8])
    store.close()
  })

  it('persists context policy, state, summaries, and compaction history per namespace', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'ctx', title: 'Context' })
    store.createConversation('account-b', { id: 'ctx', title: 'Other' })
    expect(store.updateContextPolicy('account-a', 'ctx', { strategy: 'conservative', inheritGlobal: false })).toMatchObject({ strategy: 'conservative', inheritGlobal: false })
    expect(store.getContextPolicy('account-b', 'ctx')).toBeNull()
    const state = store.upsertContextState('account-a', { conversationId: 'ctx', contextWindow: 1000, estimatedTokens: 700, messageTokens: 500, toolTokens: 100, systemTokens: 100, compactionCount: 1, latestSummaryId: null, updatedAt: '2026-08-30T10:00:00.000Z' })
    const summary = store.createContextSummary('account-a', { conversationId: 'ctx', version: 1, summaryText: 'goal', coveredTurnStart: 'turn-1', coveredTurnEnd: 'turn-2', inputTokens: 700, outputTokens: 120 })
    store.upsertContextState('account-a', { ...state, latestSummaryId: summary.id, updatedAt: '2026-08-30T10:01:00.000Z' })
    store.recordCompaction('account-a', { conversationId: 'ctx', strategy: 'conservative', triggerReason: 'manual', beforeTokens: 900, afterTokens: 500, coveredTurnStart: 'turn-1', coveredTurnEnd: 'turn-2', summaryId: summary.id, durationMs: 12 })
    const detailed = store.getConversationDetailed('account-a', 'ctx')
    expect(detailed?.context?.latestSummaryId).toBe(summary.id)
    expect(detailed?.summary?.summaryText).toBe('goal')
    expect(detailed?.compactionHistory).toHaveLength(1)
    store.upsertModelRuntime('account-a', { conversationId: 'ctx', provider: 'openai', modelId: 9, sessionFile: 'model-9.jsonl', context: { ...state, modelId: 9, provider: 'openai', contextWindow: 2000, estimatedTokens: 400, messageTokens: 300, toolTokens: 50, systemTokens: 50, updatedAt: '2026-08-30T10:02:00.000Z' } })
    expect(store.getModelRuntimeSessionFile('account-a', 'ctx', 'openai', 9)).toBe('model-9.jsonl')
    store.setModelRuntimeSessionFile('account-a', 'ctx', 'openai', 9, 'model-9-next.jsonl')
    expect(store.getModelRuntimeSessionFile('account-a', 'ctx', 'openai', 9)).toBe('model-9-next.jsonl')
    store.close()
  })
})

describe('LocalStore legacy modes', () => {
  it('reads turns written with the retired code mode back as agent', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'legacy', title: 'Legacy' })
    store.createTurn('account-a', 'legacy', {
      userMessage: { text: '旧回合', createdAt: '2026-08-30T10:01:00.000Z' },
      runtimeConfig: { mode: 'code' as unknown as ConversationTurn['runtimeConfig']['mode'] }
    })
    expect(store.listTurns('account-a', 'legacy')[0].runtimeConfig.mode).toBe('agent')
    store.close()
  })
})

describe('LocalStore 启动迁移', () => {
  /** 建一个「已跑过全部旧迁移、但缺 source_id 列」的库：这是 Hub 上线后的真实升级场景。 */
  function seedWithoutSourceColumn() {
    const root = mkdtempSync(join(tmpdir(), 'fastagent-store-'))
    tempRoots.push(root)
    const databasePath = join(root, 'fastagent.db')
    const seeded = new LocalStore(databasePath)
    seeded.upsertAbilityMeta({ abilityType: 'skill', abilityId: 'alpha', source: 'created' })
    seeded.close()
    const raw = new Database(databasePath)
    raw.exec('ALTER TABLE ability_install_meta DROP COLUMN source_id')
    raw.close()
    return databasePath
  }

  it('已是当前版本但缺 source_id 的库仍会补列，存量记录不丢', () => {
    const databasePath = seedWithoutSourceColumn()
    const store = new LocalStore(databasePath)
    const meta = store.getAbilityMeta('skill', 'alpha')
    expect(meta).toMatchObject({ abilityId: 'alpha', source: 'created' })
    expect(meta?.sourceId).toBeUndefined()
    store.close()
  })

  it('补列后能记录并读回 sourceId', () => {
    const databasePath = seedWithoutSourceColumn()
    const store = new LocalStore(databasePath)
    store.upsertAbilityMeta({ abilityType: 'skill', abilityId: 'beta', source: 'marketplace', sourceId: 'team', pluginId: 'team::skills/beta' })
    expect(store.getAbilityMeta('skill', 'beta')).toMatchObject({ sourceId: 'team', pluginId: 'team::skills/beta' })
    store.close()
  })

  it('旧库（user_version 为 0）同样补上 source_id 列', () => {
    const databasePath = seedWithoutSourceColumn()
    markLegacySchema(databasePath)
    const store = new LocalStore(databasePath)
    store.upsertAbilityMeta({ abilityType: 'cli', abilityId: 'gh', source: 'created', sourceId: 'local' })
    expect(store.getAbilityMeta('cli', 'gh')?.sourceId).toBe('local')
    store.close()
  })

  it('旧消息迁移只在构造阶段执行一次，listTurns 不重复扫描', () => {
    const migrate = vi.spyOn(schema, 'applyMigrations')
    const store = new LocalStore(':memory:')
    store.createConversation('account-a', { id: 'once', title: 'Once' })
    store.listTurns('account-a', 'once')
    store.listTurns('account-a', 'once')
    expect(migrate).toHaveBeenCalledTimes(1)
    store.close()
    migrate.mockRestore()
  })

  it('旧 schema 的 conversation_turns 重建后支持 interrupted 状态，历史数据不丢', () => {
    const root = mkdtempSync(join(tmpdir(), 'fastagent-store-'))
    tempRoots.push(root)
    const dbPath = join(root, 'fastagent.db')
    // 模拟 interrupted 引入之前的旧库：status CHECK 只有四个旧值
    const legacy = new Database(dbPath)
    legacy.exec(`
      CREATE TABLE accounts (
        namespace TEXT PRIMARY KEY,
        backend_url TEXT NOT NULL,
        user_id TEXT NOT NULL,
        refresh_token BLOB,
        locked INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE conversations (
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        session_file TEXT,
        PRIMARY KEY(namespace, conversation_id)
      );
      CREATE TABLE conversation_turns (
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        user_message TEXT NOT NULL,
        attachments TEXT NOT NULL DEFAULT '[]',
        activity TEXT,
        assistant_message TEXT,
        citations TEXT NOT NULL DEFAULT '[]',
        artifacts TEXT NOT NULL DEFAULT '[]',
        runtime_config TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL CHECK(status IN ('working', 'completed', 'failed', 'cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, turn_id)
      );
      INSERT INTO conversations VALUES ('account-a', 'c1', '旧会话', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0, NULL);
      INSERT INTO conversation_turns VALUES ('account-a', 'c1', 't1', '{"text":"旧提问","createdAt":"2026-01-01T00:00:00.000Z"}', '[]', NULL, NULL, '[]', '[]', '{}', 'completed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `)
    legacy.close()

    const store = new LocalStore(dbPath)
    // 历史数据在重建后原样保留
    expect(store.listTurns('account-a', 'c1')).toHaveLength(1)
    expect(store.listTurns('account-a', 'c1')[0].userMessage.text).toBe('旧提问')
    // 新终态可写入，不再被旧 CHECK 拒绝
    const updated = store.updateTurn('account-a', 't1', { status: 'interrupted' })
    expect(updated?.status).toBe('interrupted')
    store.close()
  })

  it('旧 schema 的 session_todos 补列并重建 CHECK 后支持七态，历史待办不丢', () => {
    const root = mkdtempSync(join(tmpdir(), 'fastagent-store-'))
    tempRoots.push(root)
    const dbPath = join(root, 'fastagent.db')
    // 模拟 Plan 分层之前的旧库：无 phase 三列，status CHECK 只有四态
    const legacy = new Database(dbPath)
    legacy.exec(`
      CREATE TABLE conversations (
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        session_file TEXT,
        PRIMARY KEY(namespace, conversation_id)
      );
      CREATE TABLE session_todos (
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','in_progress','completed','cancelled')),
        position INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, conversation_id, item_id)
      );
      INSERT INTO conversations VALUES ('account-a', 'c1', '旧会话', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0, NULL);
      INSERT INTO session_todos VALUES ('account-a', 'c1', 'i1', '旧待办', 'in_progress', 0, '2026-01-01T00:00:00.000Z');
    `)
    legacy.close()
    markLegacySchema(dbPath)

    const store = new LocalStore(dbPath)
    // 历史待办在重建后原样保留
    expect(store.listTodos('account-a', 'c1')).toEqual([{ id: 'i1', content: '旧待办', status: 'in_progress', position: 0 }])
    // 三个新列已补齐，七态可写入
    const saved = store.setTodos('account-a', 'c1', [
      { id: 'i1', content: '准备', status: 'completed', position: 0, phase: '准备', phasePosition: 1 },
      { id: 'i2', content: '被挡住', status: 'blocked', position: 1, phase: '实施', phasePosition: 2 },
      { id: 'i3', content: '放弃', status: 'skipped', position: 2, phase: '实施', phasePosition: 2 },
      { id: 'i4', content: '失败', status: 'failed', position: 3, phase: '实施', phasePosition: 2 }
    ])
    expect(saved.map((item) => item.status)).toEqual(['completed', 'blocked', 'skipped', 'failed'])
    expect(saved[1]).toMatchObject({ phase: '实施', phasePosition: 2 })
    store.close()
  })

  it('未分组的待办不带 phase 字段，读回后与旧结构一致', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'c1', title: 'T' })
    store.setTodos('account-a', 'c1', [{ id: 'i1', content: '扁平', status: 'pending', position: 0 }])
    expect(store.listTodos('account-a', 'c1')[0]).toEqual({ id: 'i1', content: '扁平', status: 'pending', position: 0 })
    store.close()
  })

  it('分阶段待办按 phase_position 优先排序', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'c1', title: 'T' })
    store.setTodos('account-a', 'c1', [
      { id: 'b', content: '实施', status: 'pending', position: 0, phase: '实施', phasePosition: 2 },
      { id: 'a', content: '准备', status: 'pending', position: 1, phase: '准备', phasePosition: 1 }
    ])
    expect(store.listTodos('account-a', 'c1').map((item) => item.id)).toEqual(['a', 'b'])
    store.close()
  })
})

describe('LocalStore projects', () => {
  it('keeps one row per path, isolates namespaces, and hides archived projects', () => {
    const store = makeStore()
    const created = store.upsertProject('account-a', { id: 'project-1', name: 'demo', path: 'K:\code\demo', color: 'calm' })
    expect(created.name).toBe('demo')
    expect(store.listProjects('account-a').map((item) => item.id)).toEqual(['project-1'])
    expect(store.listProjects('account-b')).toHaveLength(0)

    const again = store.upsertProject('account-a', { id: 'project-2', name: 'demo-renamed', path: 'K:\code\demo', color: 'tech' })
    expect(again.id).toBe('project-1')
    expect(again.name).toBe('demo-renamed')
    expect(store.listProjects('account-a')).toHaveLength(1)

    store.archiveProject('account-a', 'project-1')
    expect(store.listProjects('account-a')).toHaveLength(0)
    expect(store.listProjects('account-a', true).map((item) => item.id)).toEqual(['project-1'])

    store.removeProject('account-a', 'project-1')
    expect(store.listProjects('account-a', true)).toHaveLength(0)
    store.close()
  })
})

describe('LocalStore agent tool runtime tables', () => {
  it('records and updates tool calls, listing them by turn', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'tools', title: 'Tools' })
    store.createTurn('account-a', 'tools', { userMessage: { text: '跑一下', createdAt: '2026-08-30T10:01:00.000Z' } })
    const turnId = store.listTurns('account-a', 'tools')[0].id

    store.recordToolCall('account-a', { id: 'call-1', conversationId: 'tools', turnId, runId: 'run-1', toolName: 'bash', arguments: { command: 'npm test' }, status: 'running', permissionResult: 'allow', startedAt: '2026-08-30T10:01:00.000Z' })
    store.updateToolCall('account-a', 'call-1', { status: 'success', result: { summary: 'ok', additions: 0, deletions: 0 }, durationMs: 120, finishedAt: '2026-08-30T10:01:11.000Z' })
    store.recordToolCall('account-a', { id: 'call-2', conversationId: 'tools', turnId, runId: 'run-1', toolName: 'edit', arguments: { path: 'src/a.ts', edits: [{ oldText: 'x', newText: 'y' }] }, status: 'denied', permissionResult: 'deny', startedAt: '2026-08-30T10:01:05.000Z' })

    const calls = store.listToolCalls('account-a', turnId)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ id: 'call-1', toolName: 'bash', status: 'success', durationMs: 120, permissionResult: 'allow' })
    expect(calls[0].result).toEqual({ summary: 'ok', additions: 0, deletions: 0 })
    expect(calls[1].status).toBe('denied')

    // 删除会话级联清理
    store.removeConversation('account-a', 'tools')
    expect(store.listToolCalls('account-a', turnId)).toHaveLength(0)
    store.close()
  })

  it('replaces and lists todos per conversation', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'todo', title: 'Todo' })
    const items = store.setTodos('account-a', 'todo', [
      { id: 't1', content: '写代码', status: 'completed', position: 0 },
      { id: 't2', content: '跑测试', status: 'in_progress', position: 1 }
    ])
    expect(items.map((item) => item.content)).toEqual(['写代码', '跑测试'])
    expect(store.listTodos('account-b', 'todo')).toEqual([])

    store.setTodos('account-a', 'todo', [{ id: 't3', content: '重来', status: 'pending', position: 0 }])
    expect(store.listTodos('account-a', 'todo').map((item) => item.id)).toEqual(['t3'])
    store.close()
  })

  it('persists user permission rules with priority ordering', () => {
    const store = makeStore()
    store.upsertPermissionRule('account-a', { toolKey: 'shell', pattern: 'npm install', action: 'allow' })
    store.upsertPermissionRule('account-a', { toolKey: 'shell', pattern: 'rm -rf node_modules', action: 'allow' })
    const rules = store.listPermissionRules('account-a')
    expect(rules.map((rule) => rule.pattern)).toEqual(['npm install', 'rm -rf node_modules'])
    expect(store.listPermissionRules('account-b')).toEqual([])

    // 同键同模式覆盖，不产生重复行
    store.upsertPermissionRule('account-a', { toolKey: 'shell', pattern: 'npm install', action: 'allow' })
    expect(store.listPermissionRules('account-a')).toHaveLength(2)

    store.removePermissionRule('account-a', 'shell', 'npm install')
    expect(store.listPermissionRules('account-a').map((rule) => rule.pattern)).toEqual(['rm -rf node_modules'])
    store.close()
  })

  it('权限档位按 namespace 隔离，覆盖项往返 JSON 不失真', () => {
    const store = makeStore()
    store.savePermissionProfile('account-a', {
      id: 'audit', label: '只读审计', hint: '只看不改', base: 'ask', builtin: false,
      overrides: { edit: [{ pattern: '*', action: 'deny' }], shell: [] }, position: 3
    })
    store.savePermissionProfile('account-a', { id: 'full', label: '我的完全访问', hint: '', base: 'full', builtin: true, overrides: {}, position: 2 })
    expect(store.listPermissionProfiles('account-b')).toEqual([])

    // 按 position 升序返回
    const [fullOverride, audit] = store.listPermissionProfiles('account-a')
    expect(fullOverride).toMatchObject({ id: 'full', label: '我的完全访问', builtin: true, position: 2 })
    expect(audit).toMatchObject({ id: 'audit', label: '只读审计', base: 'ask', builtin: false, position: 3 })
    expect(audit.overrides).toEqual({ edit: [{ pattern: '*', action: 'deny' }], shell: [] })

    // 同 id 再存是覆盖而不是插入
    store.savePermissionProfile('account-a', { id: 'audit', label: '审计', hint: '', base: 'ask', builtin: false, overrides: {}, position: 3 })
    expect(store.listPermissionProfiles('account-a')).toHaveLength(2)

    store.removePermissionProfile('account-a', 'audit')
    expect(store.listPermissionProfiles('account-a').map((profile) => profile.id)).toEqual(['full'])
    store.close()
  })
})

describe('LocalStore model credentials', () => {
  const credential = (id: number) => ({ id, name: 'Demo', provider: 'openai', model_name: 'demo', base_url: 'https://provider.example/v1', api_key: `sk-${id}` })

  it('以密文落盘并按模型读回，撤销授权的模型同步清掉', () => {
    encryption.available = true
    const store = makeStore()

    store.saveModelCredentials('account-a', [credential(7), credential(8)])
    expect(store.listModelCredentials('account-a').map((item) => item.id).sort()).toEqual([7, 8])

    store.saveModelCredentials('account-a', [credential(7)])
    const remaining = store.listModelCredentials('account-a')
    expect(remaining.map((item) => item.id)).toEqual([7])
    expect(remaining[0].api_key).toBe('sk-7')

    store.clearModelCredentials('account-a')
    expect(store.listModelCredentials('account-a')).toEqual([])
    store.close()
  })

  it('系统加密不可用时拒绝落盘', () => {
    const store = makeStore()

    expect(store.saveModelCredentials('account-a', [credential(7)])).toBe(false)
    expect(store.listModelCredentials('account-a')).toEqual([])
    store.close()
  })
})

describe('LocalStore local models', () => {
  const input = (patch: Record<string, unknown> = {}) => ({
    name: 'Ollama',
    provider: 'Ollama',
    protocol: 'openai' as const,
    model_name: 'qwen2.5:7b',
    model_kind: 'chat' as const,
    base_url: 'http://127.0.0.1:11434/v1',
    api_key: 'sk-local',
    timeout: 30,
    max_retries: 2,
    extra_body: { top_p: 0.8 },
    compat: { maxTokensField: 'max_tokens' },
    ...patch
  })

  it('旧本地配置读取时将 provider 迁移为名称并补出 protocol', () => {
    const store = makeStore()
    const created = store.saveLocalModel(null, { ...input({ api_key: undefined }), protocol: undefined })
    expect(created.provider).toBe('Ollama')
    expect(created.protocol).toBe('openai')
    expect(store.getLocalModelRuntimeConfig(-created.id)?.protocol).toBe('openai')
    store.close()
  })

  it('新增本地模型：对外负数 id，密钥不出主进程', () => {
    encryption.available = true
    const store = makeStore()

    const created = store.saveLocalModel(null, input())
    expect(created.id).toBeLessThan(0)
    expect(created.name).toBe('Ollama')
    expect(created.hasApiKey).toBe(true)
    expect(created).not.toHaveProperty('api_key')
    expect(created).not.toHaveProperty('headers')

    const config = store.getLocalModelRuntimeConfig(-created.id)
    expect(config?.api_key).toBe('sk-local')
    expect(config?.timeout).toBe(30)
    expect(config?.extra_body).toEqual({ top_p: 0.8 })
    expect(config?.compat).toEqual({ maxTokensField: 'max_tokens' })
    expect(config?.headers).toBeUndefined()
    store.close()
  })

  it('更新时 api_key / headers 缺省保留旧值，显式传空清空', () => {
    encryption.available = true
    const store = makeStore()

    const created = store.saveLocalModel(null, input({ headers: { 'x-tenant': 't1' } }))
    const dbId = -created.id

    // 不传 api_key / headers：旧密钥与旧头都保留
    const renamed = store.saveLocalModel(dbId, { ...input(), api_key: undefined, headers: undefined, name: 'Ollama2' })
    expect(renamed.name).toBe('Ollama2')
    expect(store.getLocalModelRuntimeConfig(dbId)?.api_key).toBe('sk-local')
    expect(store.getLocalModelRuntimeConfig(dbId)?.headers).toEqual({ 'x-tenant': 't1' })

    // 显式清空 api_key：密钥移除，其他不变
    const cleared = store.saveLocalModel(dbId, { ...input(), api_key: '', headers: undefined })
    expect(cleared.hasApiKey).toBe(true) // headers 仍在，hasApiKey 只反映 secrets 是否存在
    expect(store.getLocalModelRuntimeConfig(dbId)?.api_key).toBe('')
    expect(store.getLocalModelRuntimeConfig(dbId)?.headers).toEqual({ 'x-tenant': 't1' })

    // 显式清空 headers：只剩空 api_key，secrets 置空
    store.saveLocalModel(dbId, { ...input(), api_key: '', headers: {} })
    expect(store.getLocalModelRuntimeConfig(dbId)?.headers).toBeUndefined()
    expect(store.listLocalModels().find((item) => item.id === created.id)?.hasApiKey).toBe(false)
    store.close()
  })

  it('删除本地模型后运行配置不可再取', () => {
    encryption.available = true
    const store = makeStore()
    const created = store.saveLocalModel(null, input())
    store.removeLocalModel(-created.id)
    expect(store.listLocalModels()).toEqual([])
    expect(store.getLocalModelRuntimeConfig(-created.id)).toBeNull()
    store.close()
  })

  it('系统加密不可用时带密钥的保存被拒绝，无密钥的模型不受影响', () => {
    const store = makeStore()
    expect(() => store.saveLocalModel(null, input())).toThrow('系统加密不可用')
    const created = store.saveLocalModel(null, { ...input(), api_key: undefined, headers: undefined })
    expect(created.hasApiKey).toBe(false)
    expect(store.getLocalModelRuntimeConfig(-created.id)?.api_key).toBe('')
    store.close()
  })
})

describe('LocalStore 能力元数据与 MCP 状态缓存', () => {
  it('写入并读回能力来源，重复 upsert 保留原安装时间', () => {
    const store = makeStore()

    const created = store.upsertAbilityMeta({ abilityType: 'skill', abilityId: 'demo', source: 'marketplace', pluginId: 'skill.demo', version: '1.0.0', installedAt: '2026-01-01T00:00:00.000Z' })
    expect(created).toMatchObject({ source: 'marketplace', pluginId: 'skill.demo', version: '1.0.0', installedAt: '2026-01-01T00:00:00.000Z', useCount: 0 })

    const updated = store.upsertAbilityMeta({ abilityType: 'skill', abilityId: 'demo', source: 'marketplace', pluginId: 'skill.demo', version: '1.1.0' })
    expect(updated.installedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(updated.version).toBe('1.1.0')
    expect(store.listAbilityMeta()).toHaveLength(1)

    store.removeAbilityMeta('skill', 'demo')
    expect(store.getAbilityMeta('skill', 'demo')).toBeNull()
    store.close()
  })

  it('回填只补没有记录的能力，来源固定为 imported', () => {
    const store = makeStore()
    store.upsertAbilityMeta({ abilityType: 'skill', abilityId: 'known', source: 'created' })

    const inserted = store.backfillAbilityMeta([
      { abilityType: 'skill', abilityId: 'known' },
      { abilityType: 'skill', abilityId: 'legacy', installedAt: '2025-12-01T00:00:00.000Z' },
      { abilityType: 'mcp', abilityId: 'srv-1', installedAt: '2025-12-02T00:00:00.000Z' }
    ])

    expect(inserted).toBe(2)
    expect(store.getAbilityMeta('skill', 'known')?.source).toBe('created')
    expect(store.getAbilityMeta('skill', 'legacy')).toMatchObject({ source: 'imported', installedAt: '2025-12-01T00:00:00.000Z' })
    expect(store.getAbilityMeta('mcp', 'srv-1')?.source).toBe('imported')
    expect(store.backfillAbilityMeta([{ abilityType: 'skill', abilityId: 'legacy' }])).toBe(0)
    store.close()
  })

  it('MCP 状态缓存跨实例保留，且只存工具描述不存密钥', () => {
    encryption.available = true
    const root = mkdtempSync(join(tmpdir(), 'fastagent-store-'))
    tempRoots.push(root)
    const databasePath = join(root, 'fastagent.db')

    const first = new LocalStore(databasePath)
    first.setMcpStatus('srv-1', {
      state: 'connected',
      testedAt: '2026-08-31T00:00:00.000Z',
      error: null,
      toolCount: 1,
      resourceCount: 2,
      promptCount: 3,
      tools: [{ name: 'search', description: '检索', inputSchema: { type: 'object' } }]
    })
    first.close()

    const second = new LocalStore(databasePath)
    const snapshot = second.getMcpStatus('srv-1')
    expect(snapshot).toMatchObject({ state: 'connected', toolCount: 1, resourceCount: 2, promptCount: 3 })
    expect(snapshot?.tools[0]).toEqual({ name: 'search', description: '检索' })
    expect(second.listMcpStatus()).toEqual([{ serverId: 'srv-1', ...snapshot }])

    second.removeMcpStatus('srv-1')
    expect(second.getMcpStatus('srv-1')).toBeNull()
    second.close()
  })

  it('listMcpServerTimestamps 返回落库时间供回填使用', () => {
    encryption.available = true
    const store = makeStore()
    store.saveMcpServer({ id: 'srv-1', name: 'demo', transport: 'stdio', command: 'npx', enabled: false, timeoutMs: 1000 })
    const stamps = store.listMcpServerTimestamps()
    expect(stamps).toHaveLength(1)
    expect(stamps[0].id).toBe('srv-1')
    expect(Number.isNaN(Date.parse(stamps[0].updatedAt))).toBe(false)
    store.close()
  })
})

describe('LocalStore 会话分页与筛选', () => {
  function seed() {
    const store = makeStore()
    store.createConversation('account-a', { id: 'c-chat', title: '聊天记录', createdAt: '2026-08-30T10:00:00.000Z' })
    store.createConversation('account-a', { id: 'c-agent', title: 'Agent 跑批', projectId: 'project-1', createdAt: '2026-08-30T11:00:00.000Z' })
    store.createConversation('account-a', { id: 'c-idle', title: '空会话', createdAt: '2026-08-30T12:00:00.000Z' })
    store.createTurn('account-a', 'c-chat', { userMessage: { text: '你好' }, runtimeConfig: { mode: 'chat' }, status: 'completed', createdAt: '2026-08-30T10:01:00.000Z' })
    store.createTurn('account-a', 'c-agent', { userMessage: { text: '跑' }, runtimeConfig: { mode: 'agent' }, status: 'failed', createdAt: '2026-08-30T11:01:00.000Z' })
    return store
  }

  it('按模式筛选时只算最后一轮，总数与返回条数一致', () => {
    const store = seed()
    // 后补一轮 chat，c-agent 的最终模式应变成 chat
    store.createTurn('account-a', 'c-agent', { userMessage: { text: '再聊' }, runtimeConfig: { mode: 'chat' }, status: 'completed', createdAt: '2026-08-30T11:05:00.000Z' })
    const page = store.listConversationsPage('account-a', { mode: 'agent' })
    expect(page.total).toBe(0)
    expect(page.items).toEqual([])
    const chat = store.listConversationsPage('account-a', { mode: 'chat' })
    expect(chat.total).toBe(2)
    expect(chat.items.map((item) => item.id).sort()).toEqual(['c-agent', 'c-chat'])
    store.close()
  })

  it('没有任何一轮的会话算 idle', () => {
    const store = seed()
    const page = store.listConversationsPage('account-a', { status: 'idle' })
    expect(page.items.map((item) => item.id)).toEqual(['c-idle'])
    expect(page.total).toBe(1)
    store.close()
  })

  it('旧库里的 code 模式归一成 agent', () => {
    const store = seed()
    store.createTurn('account-a', 'c-idle', { userMessage: { text: '旧' }, runtimeConfig: { mode: 'code' as never }, status: 'completed', createdAt: '2026-08-30T12:01:00.000Z' })
    // c-agent 本来就是 agent，c-idle 的 code 归一后也算 agent
    expect(store.listConversationsPage('account-a', { mode: 'agent' }).items.map((item) => item.id)).toEqual(['c-idle', 'c-agent'])
    store.close()
  })

  it('projectScope 区分快速对话与具体项目', () => {
    const store = seed()
    expect(store.listConversationsPage('account-a', { projectScope: 'unassigned' }).total).toBe(2)
    expect(store.listConversationsPage('account-a', { projectScope: 'project-1' }).items.map((item) => item.id)).toEqual(['c-agent'])
    expect(store.listConversationsPage('account-a', { projectScope: 'all' }).total).toBe(3)
    store.close()
  })

  it('关键词与状态叠加后 total 只算命中的行', () => {
    const store = seed()
    const page = store.listConversationsPage('account-a', { keyword: 'Agent', status: 'failed' })
    expect(page.total).toBe(1)
    expect(page.items.map((item) => item.id)).toEqual(['c-agent'])
    store.close()
  })

  it('按页长切片并按更新时间倒序', () => {
    const store = seed()
    const first = store.listConversationsPage('account-a', { pageSize: 2, page: 1 })
    expect(first.items.map((item) => item.id)).toEqual(['c-idle', 'c-agent'])
    expect(first.total).toBe(3)
    const second = store.listConversationsPage('account-a', { pageSize: 2, page: 2 })
    expect(second.items.map((item) => item.id)).toEqual(['c-chat'])
    expect(second.page).toBe(2)
    store.close()
  })

  it('页码越界时夹回最后一页并回报夹取后的页码', () => {
    const store = seed()
    const page = store.listConversationsPage('account-a', { pageSize: 2, page: 99 })
    expect(page.page).toBe(2)
    expect(page.items.map((item) => item.id)).toEqual(['c-chat'])
    store.close()
  })

  it('conversationStats 走全库口径，不受分页影响', () => {
    const store = seed()
    store.createTurn('account-a', 'c-idle', { userMessage: { text: '跑' }, runtimeConfig: { mode: 'agent' }, status: 'working', createdAt: '2026-08-30T12:01:00.000Z' })
    const stats = store.conversationStats('account-a')
    expect(stats).toEqual({ total: 3, active: 1, agent: 2, failed: 1 })
    store.close()
  })

  it('conversationStats 的归档口径只影响 total', () => {
    const store = seed()
    store.archiveConversation('account-a', 'c-agent')
    expect(store.conversationStats('account-a')).toEqual({ total: 2, active: 0, agent: 0, failed: 0 })
    expect(store.conversationStats('account-a', true).total).toBe(3)
    store.close()
  })
})

describe('LocalStore 会话重命名', () => {
  it('改标题但不动 updated_at，列表排序不变', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'c1', title: '旧的', createdAt: '2026-08-30T10:00:00.000Z' })
    store.createConversation('account-a', { id: 'c2', title: '新的', createdAt: '2026-08-30T11:00:00.000Z' })
    const renamed = store.renameConversation('account-a', 'c1', '改过了')
    expect(renamed?.title).toBe('改过了')
    expect(renamed?.updatedAt).toBe('2026-08-30T10:00:00.000Z')
    expect(store.listConversations('account-a').map((item) => item.id)).toEqual(['c2', 'c1'])
    store.close()
  })

  it('去掉首尾空白后落库', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'c1', title: '旧的' })
    expect(store.renameConversation('account-a', 'c1', '  带空格  ')?.title).toBe('带空格')
    store.close()
  })

  it('空标题直接抛错，不落库', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'c1', title: '旧的' })
    expect(() => store.renameConversation('account-a', 'c1', '   ')).toThrow('会话标题不能为空')
    expect(store.getConversation('account-a', 'c1')?.title).toBe('旧的')
    store.close()
  })

  it('按 namespace 隔离，不串改别的账号同 id 的会话', () => {
    const store = makeStore()
    store.createConversation('account-a', { id: 'same', title: 'A 的' })
    store.createConversation('account-b', { id: 'same', title: 'B 的' })
    store.renameConversation('account-a', 'same', '只改 A')
    expect(store.getConversation('account-a', 'same')?.title).toBe('只改 A')
    expect(store.getConversation('account-b', 'same')?.title).toBe('B 的')
    store.close()
  })

  it('会话不存在时返回 null', () => {
    const store = makeStore()
    expect(store.renameConversation('account-a', 'missing', '随便')).toBeNull()
    store.close()
  })
})

describe('LocalStore 客户端偏好', () => {
  it('页长写进 global scope 并能读回', () => {
    const store = makeStore()
    expect(store.updateClientPreferences('account-a', { paginationPageSize: 50 }).paginationPageSize).toBe(50)
    expect(store.getClientPreferences('account-a').paginationPageSize).toBe(50)
    // 页长是全局偏好，换账号也该看到同一个值
    expect(store.getClientPreferences('account-b').paginationPageSize).toBe(50)
    store.close()
  })

  it('账号级偏好的写入不会把页长顶回默认值', () => {
    const store = makeStore()
    store.updateClientPreferences('account-a', { paginationPageSize: 50 })
    store.updateClientPreferences('account-a', { selectedModelId: 7 })
    expect(store.getClientPreferences('account-a').paginationPageSize).toBe(50)
    store.close()
  })

  it('account scope 里残留的页长不再盖掉全局设置', () => {
    const root = mkdtempSync(join(tmpdir(), 'fastagent-store-'))
    tempRoots.push(root)
    const databasePath = join(root, 'fastagent.db')
    const store = new LocalStore(databasePath)
    store.updateClientPreferences('account-a', { selectedModelId: 3 })
    store.close()
    // 旧版本会把页长写进 account scope，模拟这种库
    const raw = new Database(databasePath)
    const payload = JSON.parse((raw.prepare('SELECT payload FROM client_preferences WHERE scope = ?').get('account-a') as { payload: string }).payload)
    raw.prepare('UPDATE client_preferences SET payload = ? WHERE scope = ?').run(JSON.stringify({ ...payload, paginationPageSize: 20 }), 'account-a')
    raw.close()

    const reopened = new LocalStore(databasePath)
    reopened.updateClientPreferences('account-a', { paginationPageSize: 50 })
    expect(reopened.getClientPreferences('account-a').paginationPageSize).toBe(50)
    reopened.close()
  })

  it('越界页长在读取时夹回合法范围', () => {
    const store = makeStore()
    store.updateClientPreferences(null, { paginationPageSize: 9999 })
    expect(store.getClientPreferences(null).paginationPageSize).toBe(100)
    store.close()
  })
})

describe('memories', () => {
  function seed(store: LocalStore) {
    const workspaceFact = store.createMemory('ns-a', { scope: 'workspace', scopeId: 'project-1', type: 'decision', content: '当前项目数据库统一使用 PostgreSQL' })
    const globalPreference = store.createMemory('ns-a', { scope: 'global', scopeId: null, type: 'preference', content: '用户偏好使用 uv 管理依赖' })
    const otherProject = store.createMemory('ns-a', { scope: 'workspace', scopeId: 'project-2', type: 'fact', content: '另一个项目使用 MySQL' })
    return { workspaceFact, globalPreference, otherProject }
  }

  it('中文内容能被 trigram 分词命中', () => {
    const store = makeStore()
    seed(store)
    const found = store.searchMemories('ns-a', { match: '"数据库"', workspaceId: 'project-1' })
    expect(found.map((memory) => memory.content)).toEqual(['当前项目数据库统一使用 PostgreSQL'])
    store.close()
  })

  it('英文长词大小写不敏感，短词走 LIKE 兜底', () => {
    const store = makeStore()
    seed(store)
    expect(store.searchMemories('ns-a', { match: '"postgresql"', workspaceId: 'project-1' })).toHaveLength(1)
    expect(store.searchMemories('ns-a', { match: null, likeTerms: ['uv'], workspaceId: 'project-1' })).toHaveLength(1)
    store.close()
  })

  it('召回只取当前项目与全局，不串其它项目', () => {
    const store = makeStore()
    seed(store)
    // 两字中文在 trigram 索引里没有对应 token，作用域过滤用 LIKE 分支验证。
    const found = store.searchMemories('ns-a', { match: null, likeTerms: ['使用'], workspaceId: 'project-1' })
    expect(found.map((memory) => memory.scopeId).sort()).toEqual([null, 'project-1'])
    store.close()
  })

  it('未归属项目的会话只召回 global', () => {
    const store = makeStore()
    seed(store)
    const found = store.searchMemories('ns-a', { match: null, likeTerms: ['使用'], workspaceId: null })
    expect(found.map((memory) => memory.scope)).toEqual(['global'])
    store.close()
  })

  it('不同账户之间互不可见', () => {
    const store = makeStore()
    seed(store)
    expect(store.searchMemories('ns-b', { match: '"数据库"', workspaceId: 'project-1' })).toEqual([])
    expect(store.listMemories('ns-b').total).toBe(0)
    store.close()
  })

  it('被替代的记忆不再参与召回，但仍可追溯', () => {
    const store = makeStore()
    const { workspaceFact } = seed(store)
    const next = store.createMemory('ns-a', { scope: 'workspace', scopeId: 'project-1', type: 'decision', content: '当前项目数据库改用 MongoDB' })
    store.supersedeMemory('ns-a', workspaceFact.id, next.id)
    expect(store.searchMemories('ns-a', { match: '"数据库"', workspaceId: 'project-1' }).map((memory) => memory.id)).toEqual([next.id])
    expect(store.getMemory('ns-a', workspaceFact.id)).toMatchObject({ status: 'superseded', supersededBy: next.id })
    store.close()
  })

  it('软删后既检索不到也不在默认列表里', () => {
    const store = makeStore()
    const { globalPreference } = seed(store)
    store.removeMemory('ns-a', globalPreference.id)
    expect(store.searchMemories('ns-a', { match: null, likeTerms: ['uv'], workspaceId: null })).toEqual([])
    expect(store.listMemories('ns-a').items.map((memory) => memory.id)).not.toContain(globalPreference.id)
    expect(store.getMemory('ns-a', globalPreference.id)?.status).toBe('deleted')
    store.close()
  })

  it('改写内容后按新内容检索，旧内容失效', () => {
    const store = makeStore()
    const { globalPreference } = seed(store)
    store.updateMemory('ns-a', globalPreference.id, { content: '用户偏好使用 poetry 管理依赖' })
    expect(store.searchMemories('ns-a', { match: '"poetry"', workspaceId: null })).toHaveLength(1)
    expect(store.searchMemories('ns-a', { match: null, likeTerms: ['uv'], workspaceId: null })).toEqual([])
    store.close()
  })

  it('清空按作用域生效，其它作用域不受影响', () => {
    const store = makeStore()
    seed(store)
    expect(store.clearMemories('ns-a', 'workspace', 'project-1')).toBe(1)
    expect(store.countMemories('ns-a')).toBe(2)
    expect(store.searchMemories('ns-a', { match: '"数据库"', workspaceId: 'project-1' })).toEqual([])
    store.close()
  })

  it('清空后 FTS 索引同步清掉，不会命中已删记录', () => {
    const store = makeStore()
    seed(store)
    store.clearMemories('ns-a')
    expect(store.searchMemories('ns-a', { match: '"数据库"', likeTerms: ['使用'], workspaceId: 'project-1' })).toEqual([])
    expect(store.countMemories('ns-a')).toBe(0)
    store.close()
  })

  it('列表按状态与类型过滤，并分页', () => {
    const store = makeStore()
    seed(store)
    expect(store.listMemories('ns-a', { type: 'preference' }).items).toHaveLength(1)
    expect(store.listMemories('ns-a', { scope: 'workspace', scopeId: 'project-2' }).items).toHaveLength(1)
    expect(store.listMemories('ns-a', { keyword: 'MySQL' }).total).toBe(1)
    store.close()
  })

  it('刷新只抬高重要性，不会调低', () => {
    const store = makeStore()
    const created = store.createMemory('ns-a', { scope: 'global', scopeId: null, type: 'fact', content: '团队使用 pnpm', importance: 4 })
    store.refreshMemory('ns-a', created.id, 2)
    expect(store.getMemory('ns-a', created.id)?.importance).toBe(4)
    store.refreshMemory('ns-a', created.id, 5)
    expect(store.getMemory('ns-a', created.id)?.importance).toBe(5)
    store.close()
  })

  it('召回后批量记录访问时间', () => {
    const store = makeStore()
    const { globalPreference } = seed(store)
    store.touchMemories('ns-a', [globalPreference.id])
    expect(store.getMemory('ns-a', globalPreference.id)?.lastAccessedAt).toBeTypeOf('number')
    store.close()
  })
})

describe('agent 运行台账', () => {
  function seedRun(store: LocalStore) {
    store.createConversation('ns-a', { id: 'c1', title: '会话' })
    store.startAgentRun('ns-a', { runId: 'run-1', conversationId: 'c1', turnId: 't1', mode: 'agent', startedAt: 1_000 })
    return { conversationId: 'c1', runId: 'run-1' }
  }

  it('运行开始后落成 running，收尾后记录状态与耗时', () => {
    const store = makeStore()
    seedRun(store)
    store.finishAgentRun('ns-a', 'run-1', 'completed', null, 3_000)
    const [entry] = store.listAgentRunLedger('ns-a', 'c1')
    expect(entry.run).toMatchObject({ status: 'completed', startedAt: 1_000, finishedAt: 3_000 })
    store.close()
  })

  it('终态只认第一次，后续事件不覆盖真实结局', () => {
    const store = makeStore()
    seedRun(store)
    store.finishAgentRun('ns-a', 'run-1', 'failed', '模型调用失败', 2_000)
    store.finishAgentRun('ns-a', 'run-1', 'completed', null, 5_000)
    expect(store.listAgentRunLedger('ns-a', 'c1')[0].run).toMatchObject({ status: 'failed', error: '模型调用失败' })
    store.close()
  })

  it('失败归类随终态一起落库', () => {
    const store = makeStore()
    seedRun(store)
    store.finishAgentRun('ns-a', 'run-1', 'failed', '502 Bad Gateway', 2_000, 'network')
    expect(store.listAgentRunLedger('ns-a', 'c1')[0].run).toMatchObject({ errorKind: 'network', retryCount: 0 })
    store.close()
  })

  it('正常结束不带失败归类', () => {
    const store = makeStore()
    seedRun(store)
    store.finishAgentRun('ns-a', 'run-1', 'completed', null, 2_000)
    expect(store.listAgentRunLedger('ns-a', 'c1')[0].run.errorKind).toBeNull()
    store.close()
  })

  it('自动重试逐次累加并落库', () => {
    const store = makeStore()
    seedRun(store)
    expect(store.bumpAgentRunRetry('ns-a', 'run-1')).toBe(1)
    expect(store.bumpAgentRunRetry('ns-a', 'run-1')).toBe(2)
    expect(store.listAgentRunLedger('ns-a', 'c1')[0].run.retryCount).toBe(2)
    store.close()
  })

  it('已结算的运行不再累加重试次数', () => {
    const store = makeStore()
    seedRun(store)
    store.bumpAgentRunRetry('ns-a', 'run-1')
    store.finishAgentRun('ns-a', 'run-1', 'completed', null, 2_000)
    // 终态之后迟到的重试事件不能改写已结算的记录
    expect(store.bumpAgentRunRetry('ns-a', 'run-1')).toBe(1)
    store.close()
  })

  it('同一 runId 重跑时归类与重试计数一并清零', () => {
    const store = makeStore()
    seedRun(store)
    store.bumpAgentRunRetry('ns-a', 'run-1')
    store.finishAgentRun('ns-a', 'run-1', 'failed', '网络异常', 2_000, 'network')
    store.startAgentRun('ns-a', { runId: 'run-1', conversationId: 'c1', turnId: 't1', mode: 'agent', startedAt: 3_000 })
    expect(store.listAgentRunLedger('ns-a', 'c1')[0].run).toMatchObject({ status: 'running', errorKind: null, retryCount: 0 })
    store.close()
  })

  it('委派任务挂在运行下，按开始时间排序', () => {
    const store = makeStore()
    seedRun(store)
    store.startAgentTask('ns-a', { taskId: 'task-2', runId: 'run-1', conversationId: 'c1', turnId: 't1', agentId: 'reviewer', agentName: 'reviewer', goal: '检查并发处理', startedAt: 2_000 })
    store.startAgentTask('ns-a', { taskId: 'task-1', runId: 'run-1', conversationId: 'c1', turnId: 't1', agentId: 'scout', agentName: 'scout', goal: '定位调用链', startedAt: 1_500 })
    const [entry] = store.listAgentRunLedger('ns-a', 'c1')
    expect(entry.tasks.map((task) => task.taskId)).toEqual(['task-1', 'task-2'])
    store.close()
  })

  it('任务收尾写入状态、摘要与耗时', () => {
    const store = makeStore()
    seedRun(store)
    store.startAgentTask('ns-a', { taskId: 'task-1', runId: 'run-1', conversationId: 'c1', turnId: 't1', agentId: 'scout', agentName: 'scout', goal: '定位调用链', startedAt: 1_000 })
    store.finishAgentTask('ns-a', 'task-1', { status: 'completed', summary: '定位到 3 处调用', finishedAt: 4_000 })
    const [task] = store.listAgentTasks('ns-a', { runId: 'run-1' })
    expect(task).toMatchObject({ status: 'completed', summary: '定位到 3 处调用', durationMs: 3_000 })
    store.close()
  })

  it('超时与取消分别落库，不混为一谈', () => {
    const store = makeStore()
    seedRun(store)
    store.startAgentTask('ns-a', { taskId: 'task-1', runId: 'run-1', conversationId: 'c1', turnId: 't1', agentId: 'scout', agentName: 'scout', goal: 'a', startedAt: 1_000 })
    store.startAgentTask('ns-a', { taskId: 'task-2', runId: 'run-1', conversationId: 'c1', turnId: 't1', agentId: 'scout', agentName: 'scout', goal: 'b', startedAt: 1_000 })
    store.finishAgentTask('ns-a', 'task-1', { status: 'timeout', error: '超时' })
    store.finishAgentTask('ns-a', 'task-2', { status: 'cancelled' })
    expect(store.listAgentTasks('ns-a', { runId: 'run-1' }).map((task) => task.status)).toEqual(['timeout', 'cancelled'])
    store.close()
  })

  it('重启后把卡住的运行与任务收敛成中断', () => {
    const store = makeStore()
    seedRun(store)
    store.startAgentTask('ns-a', { taskId: 'task-1', runId: 'run-1', conversationId: 'c1', turnId: 't1', agentId: 'scout', agentName: 'scout', goal: 'a', startedAt: 1_000 })
    expect(store.markInterruptedAgentRuns('ns-a')).toBe(1)
    const [entry] = store.listAgentRunLedger('ns-a', 'c1')
    expect(entry.run.status).toBe('interrupted')
    expect(entry.run.error).toBe('任务已中断')
    expect(entry.tasks[0].status).toBe('cancelled')
    store.close()
  })

  it('收敛时排除当前进程正在跑的运行', () => {
    const store = makeStore()
    seedRun(store)
    expect(store.markInterruptedAgentRuns('ns-a', ['run-1'])).toBe(0)
    expect(store.listAgentRunLedger('ns-a', 'c1')[0].run.status).toBe('running')
    store.close()
  })

  it('已收尾的运行不会被重启收敛改写', () => {
    const store = makeStore()
    seedRun(store)
    store.finishAgentRun('ns-a', 'run-1', 'completed', null, 2_000)
    expect(store.markInterruptedAgentRuns('ns-a')).toBe(0)
    expect(store.listAgentRunLedger('ns-a', 'c1')[0].run.status).toBe('completed')
    store.close()
  })

  /** 中断收敛的被测场景需要真实回合：只建 run 的话验不到 turn 是否一起结算。 */
  function seedRunWithTurn(store: LocalStore) {
    store.createConversation('ns-a', { id: 'c1', title: '会话' })
    store.createTurn('ns-a', 'c1', {
      id: 't1',
      userMessage: { text: '把登录页改成暗色' },
      status: 'working',
      activity: { status: 'working', startedAt: '2026-09-05T00:00:00.000Z', finishedAt: null, events: [] }
    })
    store.startAgentRun('ns-a', { runId: 'run-1', conversationId: 'c1', turnId: 't1', mode: 'agent', startedAt: 1_000 })
  }

  it('收敛中断时把卡住的回合一起结算，界面不会永久转圈', () => {
    const store = makeStore()
    seedRunWithTurn(store)
    store.markInterruptedAgentRuns('ns-a')
    const turn = store.getTurn('ns-a', 't1')
    expect(turn?.status).toBe('interrupted')
    expect(turn?.activity?.status).toBe('interrupted')
    expect(turn?.activity?.finishedAt).toBeTruthy()
    store.close()
  })

  it('已经有终态的回合不被收敛改写', () => {
    const store = makeStore()
    seedRunWithTurn(store)
    store.updateTurn('ns-a', 't1', { status: 'completed' })
    store.markInterruptedAgentRuns('ns-a')
    expect(store.getTurn('ns-a', 't1')?.status).toBe('completed')
    store.close()
  })

  it('排除在外的活跃运行，其回合也不被结算', () => {
    const store = makeStore()
    seedRunWithTurn(store)
    store.markInterruptedAgentRuns('ns-a', ['run-1'])
    expect(store.getTurn('ns-a', 't1')?.status).toBe('working')
    store.close()
  })

  it('中断运行带未完成待办时可续跑', () => {
    const store = makeStore()
    seedRunWithTurn(store)
    store.setTodos('ns-a', 'c1', [
      { id: 'i1', content: '建表', status: 'completed', position: 0 },
      { id: 'i2', content: '接线', status: 'blocked', position: 1 }
    ])
    store.markInterruptedAgentRuns('ns-a')
    const resumable = store.findResumableRun('ns-a', 'c1')
    expect(resumable).toMatchObject({ runId: 'run-1', turnId: 't1', goal: '把登录页改成暗色', pendingTodos: 1, changedFiles: 0 })
    expect(resumable?.reason).toBe('任务已中断')
    store.close()
  })

  it('正常结束的运行不可续跑', () => {
    const store = makeStore()
    seedRunWithTurn(store)
    store.finishAgentRun('ns-a', 'run-1', 'completed', null, 2_000)
    expect(store.findResumableRun('ns-a', 'c1')).toBeNull()
    store.close()
  })

  it('中断之后又跑过新一轮的会话不再提示续跑', () => {
    const store = makeStore()
    seedRunWithTurn(store)
    store.markInterruptedAgentRuns('ns-a')
    // 用户又发了一条并正常完成：上下文早已往前走，回头续跑只会制造重复劳动
    store.createTurn('ns-a', 'c1', { id: 't2', userMessage: { text: '换个思路' }, status: 'completed' })
    store.startAgentRun('ns-a', { runId: 'run-2', conversationId: 'c1', turnId: 't2', mode: 'agent', startedAt: 5_000 })
    store.finishAgentRun('ns-a', 'run-2', 'completed', null, 6_000)
    expect(store.findResumableRun('ns-a', 'c1')).toBeNull()
    store.close()
  })

  it('中断运行的文件改动计入续跑信息', () => {
    const store = makeStore()
    seedRunWithTurn(store)
    store.upsertFileChange('ns-a', { turnId: 't1', conversationId: 'c1', runId: 'run-1', path: 'src/a.ts', operation: 'update', additions: 3, deletions: 1, tools: ['edit'] })
    store.markInterruptedAgentRuns('ns-a')
    expect(store.findResumableRun('ns-a', 'c1')?.changedFiles).toBe(1)
    store.close()
  })

  it('没有会话运行记录时返回 null', () => {
    const store = makeStore()
    store.createConversation('ns-a', { id: 'c1', title: '会话' })
    expect(store.findResumableRun('ns-a', 'c1')).toBeNull()
    store.close()
  })

  it('删除会话时台账级联清掉', () => {
    const store = makeStore()
    seedRun(store)
    store.startAgentTask('ns-a', { taskId: 'task-1', runId: 'run-1', conversationId: 'c1', turnId: 't1', agentId: 'scout', agentName: 'scout', goal: 'a' })
    store.removeConversation('ns-a', 'c1')
    expect(store.listAgentRunLedger('ns-a', 'c1')).toEqual([])
    expect(store.listAgentTasks('ns-a', { conversationId: 'c1' })).toEqual([])
    store.close()
  })

  it('不同账户的台账互不可见', () => {
    const store = makeStore()
    seedRun(store)
    expect(store.listAgentRunLedger('ns-b', 'c1')).toEqual([])
    store.close()
  })
})
