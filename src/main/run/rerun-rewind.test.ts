import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { LocalStore } from '../local-store'
import type { MainContext } from '../app-context'
import { rewindSessionAfterTurnDelete, rewindSessionForRerun } from './rerun-rewind'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() }
}))

const roots: string[] = []
afterEach(() => { while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true }) })

const NS = 'account-a'
const CONV = 'conv'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-rerun-'))
  roots.push(root)
  const store = new LocalStore(join(root, 'fastagent.db'))
  store.createConversation(NS, { id: CONV, title: 'Rerun' })
  const turns = ['第一问', '第二问', '第三问'].map((text, index) => store.createTurn(NS, CONV, {
    userMessage: { text, createdAt: `2026-10-01T10:0${index}:00.000Z` },
    assistantMessage: { text: `${text}的回答` },
    status: 'completed'
  }))
  const sessionDir = join(root, 'sessions')
  const invalidate = vi.fn(async () => undefined)
  const ctx = {
    store,
    appPaths: { quickWorkspaceDir: root },
    conversationRuntimeCache: { invalidate },
    conversationRuntimeKey: (namespace: string, conversationId: string) => `${namespace}:${conversationId}`,
    conversationSessionDir: () => sessionDir,
    loadPiRuntime: () => import('../pi-runtime')
  } as unknown as MainContext
  return { root, store, turns, sessionDir, ctx, invalidate }
}

const user = (text: string) => ({ role: 'user', content: text, timestamp: Date.now() }) as never
const assistant = (text: string) => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'openai-completions',
  provider: 'test',
  model: 'test-model',
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'stop',
  timestamp: Date.now()
}) as never

/** 三轮问答的 session，返回每轮开始前的叶子节点（即锚点）。 */
function seedSession(root: string, sessionDir: string) {
  const manager = SessionManager.create(root, sessionDir)
  const anchors: Array<string | null> = []
  for (const text of ['第一问', '第二问', '第三问']) {
    anchors.push(manager.getLeafId())
    manager.appendMessage(user(text))
    manager.appendMessage(assistant(`${text}的回答`))
  }
  return { file: manager.getSessionFile() as string, anchors }
}

function sessionTexts(file: string, sessionDir: string, cwd: string): string[] {
  return SessionManager.open(file, sessionDir, cwd).buildSessionContext().messages.map((message) => {
    const content = (message as { content: unknown }).content
    return typeof content === 'string' ? content : (content as Array<{ text?: string }>).map((part) => part.text ?? '').join('')
  })
}

describe('rewindSessionForRerun', () => {
  it('有锚点时切出只含之前回合的新 session，原文件不动', async () => {
    const { root, store, turns, sessionDir, ctx, invalidate } = setup()
    const { file, anchors } = seedSession(root, sessionDir)
    store.setConversationSessionFile(NS, CONV, file)
    store.setTurnSessionAnchor(NS, turns[1].id, { sessionFile: file, leafId: anchors[1] })

    expect(await rewindSessionForRerun(ctx, NS, CONV, turns[1].id)).toBe('branch')
    const next = store.getConversationSessionFile(NS, CONV) as string
    expect(next).not.toBe(file)
    expect(sessionTexts(next, sessionDir, root)).toEqual(['第一问', '第一问的回答'])
    // 旧文件保留完整历史，新文件从它切出
    expect(sessionTexts(file, sessionDir, root)).toHaveLength(6)
    // 必须先销毁缓存的运行时，否则下一轮直接复用内存里的旧 session
    expect(invalidate).toHaveBeenCalledWith(`${NS}:${CONV}`)
    store.close()
  })

  it('重跑 session 的第一轮时直接重开 session', async () => {
    const { root, store, turns, sessionDir, ctx } = setup()
    const { file, anchors } = seedSession(root, sessionDir)
    store.setConversationSessionFile(NS, CONV, file)
    store.setTurnSessionAnchor(NS, turns[0].id, { sessionFile: file, leafId: anchors[0] })
    expect(anchors[0]).toBeNull()
    expect(await rewindSessionForRerun(ctx, NS, CONV, turns[0].id)).toBe('reset')
    expect(store.getConversationSessionFile(NS, CONV)).toBeFalsy()
    store.close()
  })

  it('旧回合没有锚点时重开 session，并用之前回合的原文做种子', async () => {
    const { root, store, turns, sessionDir, ctx } = setup()
    const { file } = seedSession(root, sessionDir)
    store.setConversationSessionFile(NS, CONV, file)
    expect(await rewindSessionForRerun(ctx, NS, CONV, turns[2].id)).toBe('reseed')
    expect(store.getConversationSessionFile(NS, CONV)).toBeFalsy()
    const seed = store.latestTurnSummary(NS, CONV)?.summaryText ?? ''
    expect(seed).toContain('第一问的回答')
    expect(seed).toContain('第二问')
    expect(seed).not.toContain('第三问')
    store.close()
  })

  it('没有 session 也没有涉及目标轮的摘要时什么都不做', async () => {
    const { store, turns, ctx, invalidate } = setup()
    expect(await rewindSessionForRerun(ctx, NS, CONV, turns[1].id)).toBe('none')
    expect(invalidate).not.toHaveBeenCalled()
    expect(store.latestTurnSummary(NS, CONV)).toBeNull()
    store.close()
  })
})

describe('rewindSessionAfterTurnDelete', () => {
  it('删掉最后一轮且锚点可信时切回这一轮之前', async () => {
    const { root, store, turns, sessionDir, ctx } = setup()
    const { file, anchors } = seedSession(root, sessionDir)
    store.setConversationSessionFile(NS, CONV, file)
    const anchor = { sessionFile: file, leafId: anchors[2] }
    const turnsBefore = store.listTurns(NS, CONV)
    store.deleteTurn(NS, turns[2].id)
    expect(await rewindSessionAfterTurnDelete(ctx, NS, CONV, { turnId: turns[2].id, turnsBefore, anchor })).toBe('branch')
    const next = store.getConversationSessionFile(NS, CONV) as string
    expect(sessionTexts(next, sessionDir, root)).toEqual(['第一问', '第一问的回答', '第二问', '第二问的回答'])
    store.close()
  })

  it('删掉中间一轮时重开 session，种子里只有剩下的回合', async () => {
    const { root, store, turns, sessionDir, ctx, invalidate } = setup()
    const { file } = seedSession(root, sessionDir)
    store.setConversationSessionFile(NS, CONV, file)
    const turnsBefore = store.listTurns(NS, CONV)
    store.deleteTurn(NS, turns[1].id)
    expect(await rewindSessionAfterTurnDelete(ctx, NS, CONV, { turnId: turns[1].id, turnsBefore, anchor: null })).toBe('reseed')
    expect(invalidate).toHaveBeenCalledWith(`${NS}:${CONV}`)
    expect(store.getConversationSessionFile(NS, CONV)).toBeFalsy()
    const seed = store.latestTurnSummary(NS, CONV)?.summaryText ?? ''
    expect(seed).toContain('第一问的回答')
    expect(seed).toContain('第三问的回答')
    expect(seed).not.toContain('第二问')
    store.close()
  })

  it('还没有 session 也没有摘要时什么都不做', async () => {
    const { store, turns, ctx, invalidate } = setup()
    const turnsBefore = store.listTurns(NS, CONV)
    store.deleteTurn(NS, turns[0].id)
    expect(await rewindSessionAfterTurnDelete(ctx, NS, CONV, { turnId: turns[0].id, turnsBefore, anchor: null })).toBe('none')
    expect(invalidate).not.toHaveBeenCalled()
    store.close()
  })
})
