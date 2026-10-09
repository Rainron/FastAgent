import type { LocalStore } from '../../local-store'
import type { KbEntry, MemoryCreateInput, MemoryRecallHit, MemoryRecord, RecallPreview } from '../../../shared/types'
import { buildMemoryQueryPlan, isEmptyQueryPlan } from './memory-query'
import { clampRecallLimit, rankMemories } from './memory-rank'
import { renderMemoryPrompt } from './memory-prompt'
import { buildExtractionPrompt, MAX_EXISTING_IN_PROMPT, parseMemoryCandidates, shouldExtractMemories } from './memory-extractor'
import { planMemoryWrites } from './memory-conflict'

export interface RecallInput {
  namespace: string
  /** 会话归属项目的 project_id；未归属会话为 null，此时只召回 global。 */
  workspaceId: string | null
  agentId?: string | null
  text: string
  maxRecall?: number
  now?: number
  /** 召回测试只是预览，不能刷新 last_accessed_at，否则会反过来影响真实召回的时新度排序。 */
  touch?: boolean
}

export interface RecallResult {
  hits: MemoryRecallHit[]
  /** 拼在本轮用户输入之前的注入片段；无命中时为空串。 */
  prompt: string
}

const EMPTY_RECALL: RecallResult = { hits: [], prompt: '' }

/** 召回：查询计划 → FTS/LIKE → 排序 → TopK → 注入片段。整条链路同步，只有一次 SQLite 查询。 */
export function recallMemories(store: LocalStore, input: RecallInput): RecallResult {
  const plan = buildMemoryQueryPlan(input.text)
  if (isEmptyQueryPlan(plan)) return EMPTY_RECALL
  const limit = clampRecallLimit(input.maxRecall)
  const now = input.now ?? Date.now()
  const found = store.searchMemories(input.namespace, {
    match: plan.match,
    likeTerms: plan.likeTerms,
    workspaceId: input.workspaceId,
    agentId: input.agentId ?? null,
    // 多取一些候选交给排序，否则 FTS 的相关度顺序会盖过重要性与时新度。
    limit: limit * 4,
    now
  })
  if (!found.length) return EMPTY_RECALL
  const hits = rankMemories(found.map((memory, index) => ({ memory, matchPosition: index })), { now, limit })
  if (!hits.length) return EMPTY_RECALL
  if (input.touch !== false) store.touchMemories(input.namespace, hits.map((hit) => hit.memory.id))
  return { hits, prompt: renderMemoryPrompt(hits) }
}

/** 项目知识库检索：查询计划复用记忆的同一套分词，对话注入与召回测试走同一条链路。 */
export function recallKnowledge(store: LocalStore, input: { namespace: string; projectId: string; text: string; limit: number }): KbEntry[] {
  const plan = buildMemoryQueryPlan(input.text)
  if (isEmptyQueryPlan(plan)) return []
  return store.searchKbEntries(input.namespace, input.projectId, plan, input.limit)
}

/**
 * 召回测试：按当前设置模拟一轮对话会注入什么。与真实召回的区别只有两点——
 * 不刷新记忆访问时间、不写召回日志；开关关着时如实返回空并标出原因，而不是偷偷按开着算。
 */
export function previewRecall(store: LocalStore, input: {
  namespace: string
  projectId: string | null
  text: string
  memory: { enabled: boolean; maxRecall: number }
  knowledge: { enabled: boolean; maxRecall: number }
}): RecallPreview {
  const memories = input.memory.enabled
    ? recallMemories(store, { namespace: input.namespace, workspaceId: input.projectId, text: input.text, maxRecall: input.memory.maxRecall, touch: false }).hits.map((hit) => hit.memory)
    : []
  const knowledge = input.knowledge.enabled && input.projectId
    ? recallKnowledge(store, { namespace: input.namespace, projectId: input.projectId, text: input.text, limit: input.knowledge.maxRecall })
    : []
  return { memories, knowledge, memoryEnabled: input.memory.enabled, knowledgeEnabled: input.knowledge.enabled }
}

export interface ExtractInput {
  namespace: string
  conversationId: string
  turnId: string
  runId: string
  workspaceId: string | null
  userText: string
  assistantText: string
}

export interface ExtractResult {
  created: MemoryRecord[]
  supersededIds: string[]
  refreshedIds: string[]
}

const EMPTY_EXTRACT: ExtractResult = { created: [], supersededIds: [], refreshedIds: [] }

/**
 * 抽取：规则先挡掉无信息量的回合，再跑一次一次性模型调用。
 * runModel 由调用方注入（主进程用 pi-runtime 的 promptModelOnce），这里不关心模型细节。
 */
export async function extractMemories(
  store: LocalStore,
  runModel: (prompt: string) => Promise<string>,
  input: ExtractInput
): Promise<ExtractResult> {
  if (!shouldExtractMemories({ userText: input.userText, assistantText: input.assistantText })) return EMPTY_EXTRACT
  const existing = store.listActiveMemoriesForScopes(input.namespace, { workspaceId: input.workspaceId, limit: MAX_EXISTING_IN_PROMPT })
  const prompt = buildExtractionPrompt(
    { userText: input.userText, assistantText: input.assistantText },
    existing,
    Boolean(input.workspaceId)
  )
  const answer = await runModel(prompt)
  if (!answer.trim()) return EMPTY_EXTRACT
  const candidates = parseMemoryCandidates(answer, Boolean(input.workspaceId))
  if (!candidates.length) return EMPTY_EXTRACT
  const plan = planMemoryWrites(candidates, existing)
  const result: ExtractResult = { created: [], supersededIds: [], refreshedIds: [] }
  for (const item of plan.refreshes) {
    store.refreshMemory(input.namespace, item.id, item.importance)
    result.refreshedIds.push(item.id)
  }
  for (const item of plan.creates) {
    const created = store.createMemory(input.namespace, {
      scope: item.candidate.scope,
      // agent 作用域由用户在管理页手工维护，抽取只产出 global / workspace。
      scopeId: item.candidate.scope === 'workspace' ? input.workspaceId : null,
      type: item.candidate.type,
      content: item.candidate.content,
      importance: item.candidate.importance,
      sourceConversationId: input.conversationId,
      sourceTurnId: input.turnId,
      sourceRunId: input.runId
    })
    result.created.push(created)
    for (const oldId of item.supersedes) {
      store.supersedeMemory(input.namespace, oldId, created.id)
      result.supersededIds.push(oldId)
    }
  }
  return result
}

/** 比自动抽取的 200 字宽松，但单条记忆仍应是一两句可复用的事实，长篇背景该放知识库。 */
export const MANUAL_MEMORY_MAX_LENGTH = 500

/**
 * 手动添加记忆。用户亲手写的比模型抽取的更可信，重要性给到 4、置信度给满，
 * 召回排序里能压过同分的自动记忆。
 */
export function createManualMemory(store: LocalStore, namespace: string, input: MemoryCreateInput): MemoryRecord {
  const content = input.content.trim()
  if (!content) throw new Error('记忆内容不能为空')
  if (content.length > MANUAL_MEMORY_MAX_LENGTH) throw new Error(`记忆内容不能超过 ${MANUAL_MEMORY_MAX_LENGTH} 字，长篇背景请放进项目知识库`)
  if (input.scope === 'workspace' && !input.scopeId) throw new Error('项目记忆需要指定项目')
  return store.createMemory(namespace, {
    scope: input.scope,
    scopeId: input.scope === 'workspace' ? input.scopeId : null,
    type: input.type,
    content,
    importance: 4,
    confidence: 1
  })
}
