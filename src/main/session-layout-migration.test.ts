import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalStore } from './local-store'
import { migrateConversationSessions, SESSION_LAYOUT_VERSION } from './session-layout-migration'
import { conversationSessionDir, legacyConversationSessionDir } from './session-paths'

const defaultRoot = join(tmpdir(), 'fastagent-session-layout-default')
mkdirSync(defaultRoot, { recursive: true })

vi.mock('electron', () => ({
  app: { getPath: () => defaultRoot },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length) rmSync(tempRoots.pop() as string, { recursive: true, force: true })
})

const NAMESPACE = 'https://api.example.com::42'
const CREATED_AT = new Date(2026, 8, 4, 10, 15).toISOString()

function setup(options: { conversationId?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-session-layout-'))
  tempRoots.push(root)
  const sessionsDir = join(root, 'sessions')
  const store = new LocalStore(join(root, 'fastagent.db'))
  const conversationId = options.conversationId ?? 'conversation-abc'
  store.createConversation(NAMESPACE, { id: conversationId, title: '旧会话', createdAt: CREATED_AT })
  store.saveAccount({ backendUrl: 'https://api.example.com', userId: '42', refreshToken: null, username: 'admin' })
  const legacyDir = legacyConversationSessionDir(sessionsDir, NAMESPACE, conversationId)
  mkdirSync(legacyDir, { recursive: true })
  const legacyFile = join(legacyDir, '2026-09-04T02-15-00-000Z_s1.jsonl')
  writeFileSync(legacyFile, '{"type":"session"}\n', 'utf8')
  const targetDir = conversationSessionDir(sessionsDir, { userSegment: 'admin', createdAt: CREATED_AT, conversationId })
  return { root, sessionsDir, store, conversationId, legacyDir, legacyFile, targetDir }
}

describe('migrateConversationSessions', () => {
  it('移动文件、改写两处库内路径并删掉空的旧目录', () => {
    const { sessionsDir, store, conversationId, legacyDir, legacyFile, targetDir } = setup()
    store.setConversationSessionFile(NAMESPACE, conversationId, legacyFile)
    store.upsertModelRuntime(NAMESPACE, {
      conversationId,
      provider: 'openai',
      modelId: 9,
      sessionFile: legacyFile,
      context: { conversationId, contextWindow: 1000, estimatedTokens: 10, messageTokens: 5, toolTokens: 3, systemTokens: 2, compactionCount: 0, latestSummaryId: null, updatedAt: CREATED_AT }
    })

    const result = migrateConversationSessions({ sessionsDir, store, namespace: NAMESPACE, userSegment: 'admin' })

    const movedFile = join(targetDir, '2026-09-04T02-15-00-000Z_s1.jsonl')
    expect(result).toEqual({ status: 'migrated', conversations: 1, files: 1 })
    expect(readFileSync(movedFile, 'utf8')).toContain('session')
    expect(existsSync(legacyDir)).toBe(false)
    expect(store.getConversationSessionFile(NAMESPACE, conversationId)).toBe(movedFile)
    expect(store.getModelRuntimeSessionFile(NAMESPACE, conversationId, 'openai', 9)).toBe(movedFile)
    expect(store.getSessionLayoutVersion(NAMESPACE)).toBe(SESSION_LAYOUT_VERSION)
    store.close()
  })

  it('版本号已就位时直接跳过', () => {
    const { sessionsDir, store, legacyFile } = setup()
    store.setSessionLayoutVersion(NAMESPACE, SESSION_LAYOUT_VERSION)

    const result = migrateConversationSessions({ sessionsDir, store, namespace: NAMESPACE, userSegment: 'admin' })

    expect(result.status).toBe('not-needed')
    expect(existsSync(legacyFile)).toBe(true)
    store.close()
  })

  it('目标已存在同名文件时不覆盖，旧文件留在原地', () => {
    const { sessionsDir, store, legacyFile, targetDir } = setup()
    mkdirSync(targetDir, { recursive: true })
    const target = join(targetDir, '2026-09-04T02-15-00-000Z_s1.jsonl')
    writeFileSync(target, '{"type":"existing"}\n', 'utf8')

    const result = migrateConversationSessions({ sessionsDir, store, namespace: NAMESPACE, userSegment: 'admin' })

    expect(result.files).toBe(0)
    expect(readFileSync(target, 'utf8')).toContain('existing')
    expect(existsSync(legacyFile)).toBe(true)
    store.close()
  })

  // 早期两代哈希（sha256(namespace)、sha256(namespace+会话+模型)）算不出来，只能靠库里记的路径找。
  it('旧目录名不是当前哈希算法时，按库里记录的路径搬', () => {
    const { sessionsDir, store, conversationId, targetDir } = setup()
    const modelBucket = join(sessionsDir, 'a'.repeat(64))
    mkdirSync(modelBucket, { recursive: true })
    const file = join(modelBucket, '2026-09-04T02-15-00-000Z_s9.jsonl')
    writeFileSync(file, '{"type":"session"}\n', 'utf8')
    store.setConversationSessionFile(NAMESPACE, conversationId, file)

    const result = migrateConversationSessions({ sessionsDir, store, namespace: NAMESPACE, userSegment: 'admin' })

    // 计算出的 legacy 目录与这个模型桶都会被搬走，两个文件都落到同一个会话目录。
    expect(result.files).toBe(2)
    expect(existsSync(join(targetDir, '2026-09-04T02-15-00-000Z_s9.jsonl'))).toBe(true)
    expect(existsSync(modelBucket)).toBe(false)
    expect(store.getConversationSessionFile(NAMESPACE, conversationId)).toBe(join(targetDir, '2026-09-04T02-15-00-000Z_s9.jsonl'))
    store.close()
  })

  it('多个会话共用的旧目录只搬本会话引用到的文件', () => {
    const { sessionsDir, store, conversationId, targetDir } = setup()
    const shared = join(sessionsDir, 'b'.repeat(64))
    mkdirSync(shared, { recursive: true })
    const mine = join(shared, 'mine.jsonl')
    const other = join(shared, 'other.jsonl')
    writeFileSync(mine, '{"type":"session"}\n', 'utf8')
    writeFileSync(other, '{"type":"session"}\n', 'utf8')
    store.createConversation(NAMESPACE, { id: 'conversation-other', title: '同目录的另一个会话', createdAt: CREATED_AT })
    store.setConversationSessionFile(NAMESPACE, conversationId, mine)
    store.setConversationSessionFile(NAMESPACE, 'conversation-other', other)

    migrateConversationSessions({ sessionsDir, store, namespace: NAMESPACE, userSegment: 'admin' })

    const otherTarget = conversationSessionDir(sessionsDir, { userSegment: 'admin', createdAt: CREATED_AT, conversationId: 'conversation-other' })
    expect(existsSync(join(targetDir, 'mine.jsonl'))).toBe(true)
    expect(existsSync(join(otherTarget, 'other.jsonl'))).toBe(true)
    expect(existsSync(shared)).toBe(false)
    store.close()
  })

  it('username 缺失时按回落的用户段迁移', () => {
    const { sessionsDir, store, conversationId } = setup()

    migrateConversationSessions({ sessionsDir, store, namespace: NAMESPACE, userSegment: '42' })

    expect(existsSync(join(sessionsDir, '42', '2026-09-04', conversationId, '2026-09-04T02-15-00-000Z_s1.jsonl'))).toBe(true)
    store.close()
  })
})
