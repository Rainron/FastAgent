import type { LocalStore } from '../../local-store'
import type { MemoryRecallHit, MemoryRecord } from '../../../shared/types'
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
  store.touchMemories(input.namespace, hits.map((hit) => hit.memory.id))
  return { hits, prompt: renderMemoryPrompt(hits) }
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
