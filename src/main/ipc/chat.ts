import { RUN_CONFLICT_MESSAGE } from '../../shared/active-runs'
import type { AgentEvent, ApprovalDecision } from '../../shared/types'
import { PauseGate } from '../agent/pause-gate'
import { checkConversationBudget } from '../agent/run-budget'
import { buildResumePrompt, isResumable } from '../agent/run-resume'
import { listPendingApprovals, respondPendingApproval } from '../approval-bridge'
import { archiveAttachments } from '../attachment-store'
import { breadcrumb } from '../logging/logger'
import { staleRunStates } from '../run-state-reconcile'
import { rewindSessionForRerun } from '../run/rerun-rewind'
import { randomUUID } from 'node:crypto'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 运行状态、发送与取消、暂停恢复、审批回应与运行台账。 */
export function registerChatIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('run-states:list', () => {
    const namespace = ctx.requireNamespace()
    const states = ctx.store.listRunStates(namespace)
    // 界面重载不重启主进程：还在 ctx.activeRuns 里的 run 仍然活着，不能跟着标失败。
    for (const state of staleRunStates(states, ctx.liveRunConversationIds(namespace))) {
      const conversation = ctx.store.getConversation(namespace, state.conversationId)
      const turn = conversation ? ctx.store.listTurns(namespace, state.conversationId).find((item) => item.status === 'working') : null
      if (turn?.activity?.execution) {
        const execution = { ...turn.activity.execution, status: 'failed' as const, activeStepId: null, activeEventId: null, activeThinkingId: null, steps: turn.activity.execution.steps.map((step) => step.status === 'running' ? { ...step, status: 'failed' as const } : step), events: turn.activity.execution.events.map((event) => event.status === 'running' ? { ...event, status: 'failed' as const, completedAt: event.completedAt ?? Date.now() } : event) }
        ctx.store.updateTurn(namespace, turn.id, { activity: { ...turn.activity, status: 'failed', finishedAt: new Date().toISOString(), execution }, status: 'failed' })
      }
      ctx.store.saveRunState(namespace, { ...state, status: 'failed', hasUnreadResult: true, updatedAt: Date.now() })
    }
    return ctx.store.listRunStates(namespace)
  })
  handle('run-states:save', (_event, state) => ctx.store.saveRunState(ctx.requireNamespace(), state))
  handle('run-states:read', (_event, conversationId: string) => ctx.store.markRunRead(ctx.requireNamespace(), conversationId))
  /** 界面重载后靠这个把 runId 与回合接回来：主进程还留着这些 run。 */
  handle('chat:list-active', () => {
    const namespace = ctx.requireNamespace()
    return [...ctx.activeRuns.entries()]
      .filter(([, run]) => run.namespace === namespace)
      .map(([runId, run]) => ({ runId, conversationId: run.conversationId, turnId: run.turnId }))
  })

  /**
   * 界面重载后取回仍在等答复的审批与提问。
   *
   * 不补这条通道的话，重载会把弹层连同挂起请求一起丢掉，而主进程还在 await：
   * 整轮既不推进也不结束，界面只剩一个「准备中」。
   */
  handle('chat:list-pending-approvals', () => {
    const namespace = ctx.requireNamespace()
    const runIds = new Set([...ctx.activeRuns.entries()].filter(([, run]) => run.namespace === namespace).map(([runId]) => runId))
    return listPendingApprovals(runIds).map(({ runId, request }) => ({
      runId,
      request,
      conversationId: ctx.activeRuns.get(runId)?.conversationId ?? null
    }))
  })

  handle('chat:send', async (_event, input) => {
    const sendStartedAt = Date.now()
    const namespace = ctx.requireNamespace()
    if (!ctx.store.getConversation(namespace, input.conversationId)) throw new Error('会话不存在')
    // 守卫放在建 turn 之前：先建后拒会留下一条永远 working 的孤儿回合。
    if (ctx.hasActiveRun(namespace, input.conversationId)) throw new Error(RUN_CONFLICT_MESSAGE)
    // 预算同理：跑到一半才发现超预算，钱已经花了，拦不住任何东西。
    const budget = checkConversationBudget(ctx.store.getModelUsage(namespace, input.conversationId).session, ctx.settings.limits)
    if (!budget.allowed) throw new Error(budget.reason)
    const now = new Date().toISOString()
    const runtimeConfig = { modelId: input.modelId ?? null, thinkingLevel: input.thinkingLevel || 'auto', mode: input.mode, permission: input.permission || null, project: ctx.store.getConversationRoot(namespace, input.conversationId) }
    const attachments = archiveAttachments(ctx.appPaths.attachmentsDir, input.conversationId, input.attachments || [], ctx.settings)
    const rerunTurnId = input.turnId && ctx.store.getTurn(namespace, input.turnId)?.conversationId === input.conversationId ? input.turnId : null
    if (input.turnId && !rerunTurnId) throw new Error('会话轮记录不存在')
    // 重跑 / 编辑重发：这一轮之后的对话都建立在旧回答上，一并删掉；模型上下文在下面排队执行前回退。
    if (rerunTurnId) ctx.store.deleteTurnsAfter(namespace, input.conversationId, rerunTurnId)
    const turn = rerunTurnId
      ? ctx.store.updateTurn(namespace, rerunTurnId, { userMessage: { text: input.prompt, createdAt: now }, attachments, runtimeConfig, assistantMessage: null, activity: { status: 'working', startedAt: now, finishedAt: null, events: [] }, status: 'working' })
      : ctx.store.createTurn(namespace, input.conversationId, { userMessage: { text: input.prompt, createdAt: now }, attachments, runtimeConfig, activity: { status: 'working', startedAt: now, finishedAt: null, events: [] }, status: 'working', createdAt: now })
    if (!turn) throw new Error('会话轮记录不存在')
    // 绑定以实际发出的模型为准：新会话首轮在这里落库，之后重开会话才能还原成同一个模型。
    ctx.store.setConversationModelId(namespace, input.conversationId, input.modelId ?? null)
    const runId = randomUUID()
    ctx.store.saveRunState(namespace, { conversationId: input.conversationId, projectId: ctx.store.getConversation(namespace, input.conversationId)?.projectId ?? null, status: 'running', hasUnreadResult: false, updatedAt: Date.now() })
    const controller = new AbortController()
    ctx.activeRuns.set(runId, { controller, namespace, conversationId: input.conversationId, turnId: turn.id })
    breadcrumb('run', `start ${runId} conv=${input.conversationId} model=${input.modelId ?? 'default'}`)
    const acceptedAt = Date.now()
    console.info('[run-timing]', { runId, conversationId: input.conversationId, turnId: turn.id, phase: 'ack', sendMs: acceptedAt - sendStartedAt })
    // 下一事件循环才进入压缩与运行时初始化，保证 invoke ACK 先回到渲染层。
    setImmediate(() => {
      const credentials = input.modelId === null || input.modelId === undefined ? null : (() => { try { return ctx.resolveModelCredentials(input.modelId) } catch { return null } })()
      const scheduled = ctx.runScheduler.schedule({
        conversationId: ctx.conversationRuntimeKey(namespace, input.conversationId),
        provider: credentials?.provider ?? 'unknown',
        modelId: input.modelId ?? -1
      }, () => ctx.conversationRuns.run(ctx.conversationRuntimeKey(namespace, input.conversationId), async () => {
        // 回退要销毁缓存的运行时，只能排在该会话的串行队列里做；失败时照常跑，退化成回退前的行为。
        if (rerunTurnId) await rewindSessionForRerun(ctx, namespace, input.conversationId, rerunTurnId).catch((error) => console.warn('[rerun] 回退会话上下文失败:', error))
        return ctx.runLocalRun(runId, turn.id, input.conversationId, namespace, input.prompt, input.mode, input.modelId, input.thinkingLevel || 'auto', input.permission || null, input.modePrompt || '', Boolean(input.planMode), attachments, controller.signal, acceptedAt)
      }))
      ctx.activeRunCancels.set(runId, scheduled.cancel)
      void scheduled.promise.catch((error) => console.error('[chat:run]', error)).finally(() => ctx.activeRunCancels.delete(runId))
    })
    return { runId, turnId: turn.id, turn }
  })
  // 快速对话专用通道：直接调模型接口，不走 pi 运行时，首 token 最快。
  handle('chat:quick-send', async (_event, input: { conversationId: string; prompt: string; modelId: number | null; thinkingLevel: import('../../shared/types').ThinkingLevel; mode?: import('../../shared/types').ConversationMode; permission?: import('../../shared/types').PermissionPreset | null }) => {
    const sendStartedAt = Date.now()
    const namespace = ctx.requireNamespace()
    if (!ctx.store.getConversation(namespace, input.conversationId)) throw new Error('会话不存在')
    if (ctx.hasActiveRun(namespace, input.conversationId)) throw new Error(RUN_CONFLICT_MESSAGE)
    // agent 模式要工具、沙箱与审批，直连模型的快速通道给不了，整轮改走与主窗口相同的运行时。
    const agentMode = input.mode === 'agent'
    const quickPermission = agentMode ? input.permission ?? 'ask' : null
    // 预算检查只对 agent 轮生效，口径与 chat:send 保持一致；直连快问维持原行为。
    if (agentMode) {
      const budget = checkConversationBudget(ctx.store.getModelUsage(namespace, input.conversationId).session, ctx.settings.limits)
      if (!budget.allowed) throw new Error(budget.reason)
    }
    const now = new Date().toISOString()
    const runtimeConfig = { modelId: input.modelId ?? null, thinkingLevel: input.thinkingLevel || 'auto', mode: agentMode ? 'agent' as const : 'chat' as const, permission: quickPermission }
    const turn = ctx.store.createTurn(namespace, input.conversationId, { userMessage: { text: input.prompt, createdAt: now }, attachments: [], runtimeConfig, activity: { status: 'working', startedAt: now, finishedAt: null, events: [] }, status: 'working', createdAt: now })
    const runId = randomUUID()
    ctx.store.saveRunState(namespace, { conversationId: input.conversationId, projectId: ctx.store.getConversation(namespace, input.conversationId)?.projectId ?? null, status: 'running', hasUnreadResult: false, updatedAt: Date.now() })
    const controller = new AbortController()
    ctx.activeRuns.set(runId, { controller, namespace, conversationId: input.conversationId, turnId: turn.id })
    breadcrumb('run', `quick-start ${runId} conv=${input.conversationId} model=${input.modelId ?? 'default'}`)
    const acceptedAt = Date.now()
    // 下一事件循环才进入执行，保证 invoke ACK 先回到渲染层（与 chat:send 一致）。
    setImmediate(() => {
      const key = ctx.conversationRuntimeKey(namespace, input.conversationId)
      const credentials = agentMode && input.modelId !== null && input.modelId !== undefined
        ? (() => { try { return ctx.resolveModelCredentials(input.modelId) } catch { return null } })()
        : null
      const scheduled = ctx.runScheduler.schedule({
        conversationId: key,
        // 排队分组按真实 provider 走，agent 轮不能和直连快问共用 'quick' 这一档。
        provider: agentMode ? credentials?.provider ?? 'unknown' : 'quick',
        modelId: input.modelId ?? -1
      }, () => ctx.conversationRuns.run(key, () => agentMode
        ? ctx.runLocalRun(runId, turn.id, input.conversationId, namespace, input.prompt, 'agent', input.modelId, input.thinkingLevel || 'auto', quickPermission, '', false, [], controller.signal, acceptedAt)
        : ctx.runQuickChat(runId, turn.id, input.conversationId, namespace, input.prompt, input.modelId, input.thinkingLevel || 'auto', controller.signal, acceptedAt)))
      ctx.activeRunCancels.set(runId, scheduled.cancel)
      void scheduled.promise.catch((error) => console.error('[chat:quick-run]', error)).finally(() => ctx.activeRunCancels.delete(runId))
    })
    console.info('[run-timing]', { runId, conversationId: input.conversationId, turnId: turn.id, phase: 'ack', sendMs: acceptedAt - sendStartedAt })
    return { runId, turnId: turn.id, turn }
  })
  handle('chat:cancel', (_event, runId: string) => {
    breadcrumb('run', `cancel ${runId}`)
    ctx.activeRunCancels.get(runId)?.()
    ctx.activeRunCancels.delete(runId)
    // 暂停中的运行也要能取消：先放行闸门，abort 之后的收尾才跑得下去。
    ctx.runPauseGates.get(runId)?.resume()
    ctx.runPauseGates.delete(runId)
    ctx.activeRuns.get(runId)?.controller.abort()
    ctx.activeRuns.delete(runId)
  })
  /**
   * 暂停 / 继续。
   *
   * 能挡住的只有「下一次工具调用」：已经发出的模型请求没有中断通道，
   * 正在执行的工具也不会被打断。返回值与事件文案都按这个边界写，
   * 不在按下的瞬间宣称已经停住。
   */
  handle('chat:pause', (_event, runId: string): boolean => {
    const run = ctx.activeRuns.get(runId)
    if (!run) return false
    const gate = ctx.runPauseGates.get(runId) ?? new PauseGate()
    ctx.runPauseGates.set(runId, gate)
    gate.pause()
    ctx.store.saveRunState(run.namespace, {
      conversationId: run.conversationId,
      projectId: ctx.store.getConversation(run.namespace, run.conversationId)?.projectId ?? null,
      status: 'paused',
      hasUnreadResult: false,
      updatedAt: Date.now()
    })
    ctx.mainWindow?.webContents.send('agent:event', {
      runId,
      conversationId: run.conversationId,
      turnId: run.turnId,
      type: 'run_phase',
      phase: 'prompting',
      detail: '已请求暂停：当前这一步跑完后停在下一次工具调用前',
      status: 'running',
      timestamp: Date.now()
    } satisfies AgentEvent)
    return true
  })
  handle('chat:resume', (_event, runId: string): boolean => {
    const gate = ctx.runPauseGates.get(runId)
    const run = ctx.activeRuns.get(runId)
    if (!gate || !run) return false
    gate.resume()
    ctx.runPauseGates.delete(runId)
    ctx.store.saveRunState(run.namespace, {
      conversationId: run.conversationId,
      projectId: ctx.store.getConversation(run.namespace, run.conversationId)?.projectId ?? null,
      status: 'running',
      hasUnreadResult: false,
      updatedAt: Date.now()
    })
    ctx.mainWindow?.webContents.send('agent:event', {
      runId,
      conversationId: run.conversationId,
      turnId: run.turnId,
      type: 'run_phase',
      phase: 'prompting',
      detail: '已继续执行',
      status: 'running',
      timestamp: Date.now()
    } satisfies AgentEvent)
    return true
  })
  handle('chat:approval-respond', (_event, input: { id: string; decision: ApprovalDecision; answer?: string; runId: string }) => {
    respondPendingApproval(input)
  })
  handle('agent-runs:list', (_event, conversationId: string, limit?: number) => ctx.store.listAgentRunLedger(ctx.requireNamespace(), conversationId, limit ?? 20))
  handle('agent-tasks:list', (_event, query: { runId?: string; conversationId?: string; turnId?: string; limit?: number } = {}) => ctx.store.listAgentTasks(ctx.requireNamespace(), query))
  // 完整性校验要把上百 MB 的二进制全读一遍算 sha256，只在用户主动点「完整性校验」时做。
  handle('agent-runs:resumable', (_event, conversationId: string) => {
    const candidate = ctx.store.findResumableRun(ctx.requireNamespace(), conversationId)
    // 全做完之后才中断的运行没有续跑价值，不给入口
    return candidate && isResumable(candidate) ? candidate : null
  })
  handle('agent-runs:resume-prompt', (_event, runId: string) => {
    const namespace = ctx.requireNamespace()
    const run = ctx.store.getAgentRun(namespace, runId)
    if (!run || run.status !== 'interrupted') return null
    const candidate = ctx.store.findResumableRun(namespace, run.conversationId)
    if (!candidate || candidate.runId !== runId) return null
    return buildResumePrompt({
      goal: candidate.goal,
      reason: candidate.reason,
      todos: ctx.store.listTodos(namespace, run.conversationId),
      changedFiles: candidate.changedFiles
    })
  })
}
