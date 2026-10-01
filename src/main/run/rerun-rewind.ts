import { existsSync } from 'node:fs'
import type { ConversationTurn, TurnSessionAnchor } from '../../shared/types'
import type { MainContext } from '../app-context'
import { estimateTokens, turnsAfterCoveredTurn } from '../context-manager'
import { buildRewindSeed, planSessionRewind, summaryCoversTurn, type SessionRewindPlan } from '../session-rewind'

/**
 * 重跑 / 编辑重发第 N 轮之前，把模型上下文退回到第 N 轮开始之前。
 *
 * 界面上删掉后续回合只是表象：Pi session 按会话共用，不回退的话模型仍然记得被删掉的问答，
 * 连第 N 轮自己的旧回答也还在上下文里，新回答会被旧内容带偏。
 *
 * 必须在该会话的运行串行队列里、runLocalRun 之前调用：要先销毁缓存的运行时再动 session 文件，
 * 否则下一轮会直接复用内存里那份旧 session，文件换了也不生效。
 */
export async function rewindSessionForRerun(ctx: MainContext, namespace: string, conversationId: string, turnId: string): Promise<SessionRewindPlan['kind']> {
  const currentSessionFile = ctx.store.getConversationSessionFile(namespace, conversationId) || null
  const anchor = ctx.store.getTurnSessionAnchor(namespace, turnId)
  const turns = ctx.store.listTurns(namespace, conversationId)
  const index = turns.findIndex((turn) => turn.id === turnId)
  if (index < 0) return 'none'
  const summary = ctx.store.latestTurnSummary(namespace, conversationId)
  const summaryCoversTarget = summary ? summaryCoversTurn(summary.coveredTurnEnd, turns, index) : false
  const plan = planSessionRewind({
    anchor,
    currentSessionFile,
    anchorFileExists: anchor ? existsSync(anchor.sessionFile) : false,
    summaryCoversTarget
  })
  if (plan.kind === 'none') return plan.kind
  await ctx.conversationRuntimeCache.invalidate(ctx.conversationRuntimeKey(namespace, conversationId))

  if (plan.kind === 'branch') {
    try {
      const { branchSessionFile } = await ctx.loadPiRuntime()
      const next = branchSessionFile({
        sessionFile: plan.sessionFile,
        sessionDir: ctx.conversationSessionDir(namespace, conversationId),
        cwd: ctx.store.getConversationRoot(namespace, conversationId) ?? ctx.appPaths.quickWorkspaceDir,
        leafId: plan.leafId
      })
      // 路径上没有助手消息时 Pi 不落盘：那段历史本来就没有对话可带，从空 session 开始即可。
      ctx.store.setConversationSessionFile(namespace, conversationId, next ?? '')
      return plan.kind
    } catch (error) {
      // 节点找不到（文件被外部改过）等情况：退回原文种子，总比带着要撤掉的历史继续跑强。
      console.warn('[rerun] 按锚点切分 session 失败，改用原文种子:', error)
    }
  }

  ctx.store.setConversationSessionFile(namespace, conversationId, '')
  if (plan.kind === 'reset') return plan.kind

  // 重做种子：第 N 轮之前还没被摘要覆盖的回合用原文补上；摘要本身覆盖到 N 或更后面时整份不用。
  const before = turns.slice(0, index)
  const previous = summary && !summaryCoversTarget ? summary : null
  const uncovered = previous ? turnsAfterCoveredTurn(before, previous.coveredTurnEnd) : before
  const seed = buildRewindSeed(uncovered, previous?.summaryText ?? null)
  // 没有可带内容但旧摘要涉及被撤掉的回合时，也要落一份空种子把它顶掉。
  if (seed || summary) {
    ctx.store.createContextSummary(namespace, {
      conversationId,
      version: (ctx.store.listContextSummaries(namespace, conversationId).at(-1)?.version ?? 0) + 1,
      summaryText: seed,
      coveredTurnStart: before[0]?.id ?? null,
      coveredTurnEnd: before.at(-1)?.id ?? null,
      inputTokens: 0,
      outputTokens: estimateTokens(seed),
      source: 'turns'
    })
  }
  return 'reseed'
}

/**
 * 删除第 N 轮问答之后，把模型上下文里的这一轮也去掉。
 *
 * 库里删掉只是界面看不见：Pi session 仍按会话共用，下一轮模型照样读到被删的问答。
 * 删的是最后一轮且锚点可信时，直接按锚点切回这一轮之前（与重跑同一条路径，原文无损）；
 * 删的是中间某一轮时没法从 session 里抠掉一段，只能重开 session，用剩余回合的原文重做种子。
 *
 * 调用方需在删库之前取好 turnsBefore（删之前的回合列表），并保证这时该会话没有运行中的任务。
 */
export async function rewindSessionAfterTurnDelete(ctx: MainContext, namespace: string, conversationId: string, deleted: { turnId: string; turnsBefore: ConversationTurn[]; anchor: TurnSessionAnchor | null }): Promise<SessionRewindPlan['kind']> {
  const index = deleted.turnsBefore.findIndex((turn) => turn.id === deleted.turnId)
  if (index < 0) return 'none'
  const currentSessionFile = ctx.store.getConversationSessionFile(namespace, conversationId) || null
  const summary = ctx.store.latestTurnSummary(namespace, conversationId)
  const summaryCoversDeleted = summary ? summaryCoversTurn(summary.coveredTurnEnd, deleted.turnsBefore, index) : false
  if (!currentSessionFile && !summaryCoversDeleted) return 'none'
  await ctx.conversationRuntimeCache.invalidate(ctx.conversationRuntimeKey(namespace, conversationId))

  const isLast = index === deleted.turnsBefore.length - 1
  const plan = isLast
    ? planSessionRewind({ anchor: deleted.anchor, currentSessionFile, anchorFileExists: deleted.anchor ? existsSync(deleted.anchor.sessionFile) : false, summaryCoversTarget: summaryCoversDeleted })
    : { kind: 'reseed' as const }
  if (plan.kind === 'branch') {
    try {
      const { branchSessionFile } = await ctx.loadPiRuntime()
      const next = branchSessionFile({
        sessionFile: plan.sessionFile,
        sessionDir: ctx.conversationSessionDir(namespace, conversationId),
        cwd: ctx.store.getConversationRoot(namespace, conversationId) ?? ctx.appPaths.quickWorkspaceDir,
        leafId: plan.leafId
      })
      ctx.store.setConversationSessionFile(namespace, conversationId, next ?? '')
      return plan.kind
    } catch (error) {
      console.warn('[turn-delete] 按锚点切分 session 失败，改用原文种子:', error)
    }
  }

  ctx.store.setConversationSessionFile(namespace, conversationId, '')
  if (plan.kind === 'reset' || plan.kind === 'none') return plan.kind
  const remaining = ctx.store.listTurns(namespace, conversationId)
  const previous = summary && !summaryCoversDeleted ? summary : null
  const uncovered = previous ? turnsAfterCoveredTurn(remaining, previous.coveredTurnEnd) : remaining
  const seed = buildRewindSeed(uncovered, previous?.summaryText ?? null)
  if (seed || summary) {
    ctx.store.createContextSummary(namespace, {
      conversationId,
      version: (ctx.store.listContextSummaries(namespace, conversationId).at(-1)?.version ?? 0) + 1,
      summaryText: seed,
      coveredTurnStart: remaining[0]?.id ?? null,
      coveredTurnEnd: remaining.at(-1)?.id ?? null,
      inputTokens: 0,
      outputTokens: estimateTokens(seed),
      source: 'turns'
    })
  }
  return 'reseed'
}
