import type { Attachment, ConversationMode, LocalModelApi, PermissionPreset, ThinkingLevel } from '../../shared/types'
import type { Ability, AgentEvent, ApprovalDecision, KbEntry, SkillAbility } from '../../shared/types'
import { resolveAgentAbilities } from '../abilities'
import { buildFaDirectoryContext, mergeAgentContextFiles, readAgentContextFiles } from '../agent-context'
import { buildTurnContextSources } from '../agent/context-sources'
import { createExecutionState, reduceExecutionState, syncExecutionSteps } from '../agent/execution-state'
import { renderKbPrompt, withMemoryPrompt } from '../agent/memory/memory-prompt'
import { buildMemoryQueryPlan, isEmptyQueryPlan } from '../agent/memory/memory-query'
import { extractMemories, recallMemories } from '../agent/memory/memory-service'
import { classifyRunError } from '../agent/run-error'
import { stopBackgroundShells } from '../agent/tools/background-shell'
import { projectRunState, resolveTurnWrite } from '../agent/run-state'
import { SANDBOX_DEGRADED_NOTICE, describeSandboxError } from '../agent/sandbox/sandbox-errors'
import { sandboxBlockedEvent, sandboxDegradedEvent } from '../agent/sandbox/sandbox-events'
import { buildSandboxPolicy } from '../agent/sandbox/sandbox-policy'
import type { SandboxSession } from '../agent/sandbox/sandbox-types'
import { resolveBashPath, resolveShellToolName } from '../agent/sandbox/shell-resolver'
import { normalizeCustomSubAgents, resolveSubAgentConfig } from '../agent/subagent/subagent-config'
import { forwardSubAgentEvent, isSubAgentTerminalEvent } from '../agent/subagent/subagent-events'
import { parseSubAgentHandoff, truncateSubAgentOutput } from '../agent/subagent/subagent-handoff'
import type { ScheduledSubAgentTask } from '../agent/subagent/subagent-scheduler'
import type { SubAgentResult } from '../agent/subagent/subagent-types'
import { clearRunBaselines } from '../agent/tool-runtime'
import { createApprovalBridge } from '../approval-bridge'
import { resolvePolicy, splitTurns } from '../context-manager'
import { needsSessionRebuild, resolveModelProtocol } from '../../shared/model-protocols'
import { compactIfOverThreshold } from './compaction-trigger'
import type { ContextMeasurement } from '../context-meter'
import { LocalStore } from '../local-store'
import { breadcrumb } from '../logging/logger'
import type { LocalMcpManager, McpToolBinding } from '../mcp-manager'
import type { PiSessionRuntime, RuntimeRunOptions } from '../pi-runtime'
import { sendQuickWindowEvent } from '../quick-window'
import { executionInputForEvent } from '../run/execution-input'
import { verificationCommandsFor } from '../run/verification-cache'
import { createTokenEventBatcher } from '../token-event-batcher'
import { persistableEvent } from '../turn-activity'
import { createHash, randomUUID } from 'node:crypto'
import type { CachedConversationRuntime } from '../app-context'
import type { RunContext } from './context'

type AbilityUsageSink = (type: 'skill' | 'mcp', id: string) => void

/** 当前这一轮的能力使用记录入口。跨轮复用的运行时扩展只认这个转发点。 */
let abilityUsageSink: AbilityUsageSink | null = null

export async function runLocalRun(ctx: RunContext, runId: string, turnId: string, conversationId: string, namespace: string, prompt: string, mode: ConversationMode, modelId: number | null, thinkingLevel: ThinkingLevel, permission: PermissionPreset | null, modePrompt: string, planMode: boolean, attachments: Attachment[], signal: AbortSignal, acceptedAt = Date.now()) {  // 主进程累积一份助手文本：渲染进程切走会话后流式状态就没了，只有这份能在
  // 终态时兜底落库。cancelled / failed 以及 completed 不带 text 的分支都靠它。
  let streamedText = ''
  // 思考全文：与回答正文分开累积，只落进 activity.thinking，不参与 textLength 与轨迹切分
  let thinkingText = ''
  // 再按思考轮次切一份：执行轨迹上每个 Thinked 组要能展开自己那一轮，靠全文只有第一个组有内容
  const thinkingSegments: string[] = []
  let sequence = 0
  // 使用统计按「本轮用没用到」计一次，不是调用次数：better-sqlite3 是同步的，
  // 每次工具调用都写一行会直接顶在 IPC 前面。
  const usedAbilities = new Set<string>()
  const onAbilityUsed: AbilityUsageSink = (type, id) => {
    const key = `${type}::${id}`
    if (usedAbilities.has(key)) return
    usedAbilities.add(key)
    try {
      ctx.store.touchAbilityUsage(type, id)
    } catch {
      // 统计写失败不该影响这轮对话。
    }
  }
  abilityUsageSink = onAbilityUsed
  let execution = createExecutionState(runId, ctx.store.listTodos(namespace, conversationId))
  let firstTokenAt: number | null = null
  // 本轮结束后从 Pi 当前有效消息树生成快照；总量用 provider usage，分类按真实 session 消息校准。
  let latestContextMeasurement: ContextMeasurement | undefined
  // 快速对话窗口与主窗口共用同一套会话管线，事件需要双端投递
  const sendEvent = (event: AgentEvent) => {
    ctx.mainWindow?.webContents.send('chat:event', event)
    sendQuickWindowEvent('chat:event', event)
  }
  const eventBatcher = createTokenEventBatcher(sendEvent, 16)
  const emit = (event: Omit<AgentEvent, 'runId'>) => {
    const timestamp = Date.now()
    // 分段与执行轨迹的 Thinking 动作一一对应：轨迹每收到一个 thinking_started 就新增一个动作。
    if (event.type === 'thinking_started') thinkingSegments.push('')
    if (event.type === 'thinking' && event.text) {
      if (!thinkingSegments.length) thinkingSegments.push('')
      thinkingSegments[thinkingSegments.length - 1] += event.text
    }
    if (event.type === 'usageUpdated' && event.usageRecord) {
      ctx.store.recordModelUsage(namespace, event.usageRecord)
      event.usage = ctx.store.getModelUsage(namespace, conversationId, turnId)
    }
    // 四处状态（会话列表 / 台账 / 回合 / activity）统一由 projectRunState 一次算出，调用点不再各自判断。
    const projection = projectRunState(event.type)
    if (projection.runStatus) ctx.store.saveRunState(namespace, { conversationId, projectId: ctx.store.getConversation(namespace, conversationId)?.projectId ?? null, status: projection.runStatus, hasUnreadResult: projection.hasUnreadResult, updatedAt: timestamp })
    // 非 token 事件携带「此刻已输出的可见正文长度」，执行轨迹按它在正文里切分文本段；
    // token 分支在下方累计 streamedText，进落库分支时已是当前值。
    if (event.type === 'todo_changed' && event.todos) execution = syncExecutionSteps(execution, event.todos)
    const executionInput = executionInputForEvent(event, timestamp, execution)
    if (executionInput) {
      execution = reduceExecutionState(execution, executionInput)
      event.eventId = executionInput.eventId
      event.stepId = executionInput.stepId
      event.thinkingId = executionInput.thinkingId
    }
    const fullEvent: AgentEvent = { runId, conversationId, turnId, timestamp, sequence: ++sequence, elapsedMs: timestamp - acceptedAt, textLength: streamedText.length, ...event, execution }
    // 终态正文以累计的流式全文为准：event.text 只含最后一条 assistant 消息，而 textLength
    // 与轨迹切分都按累计全文计算；完整轨迹与最终回答分开保存，避免执行过程污染最终回答。
    if (streamedText && projection.terminal && projection.terminal !== 'cancelled') fullEvent.transcriptText = streamedText
    // 终态带上思考全文：渲染进程的实时 turn 是自己拼的，拿不到主进程累积值，靠这个补齐
    if (thinkingText && projection.terminal) fullEvent.thinkingText = thinkingText
    if (thinkingSegments.length && projection.terminal) fullEvent.thinkingSegments = [...thinkingSegments]
    // 流式增量只推给渲染进程：逐 token 落库既是每字一次写盘，又让助手文本在
    // messageTokens 之外被 toolTokens 重复计一遍。完整文本由终态事件收尾。
    if (event.type === 'token' || event.type === 'thinking') {
      // 思考正文单独累积：不进 streamedText（不能混入回答），由后续落库分支写进 activity.thinking
      if (event.type === 'thinking' && event.text) thinkingText += event.text
      if (event.type === 'token' && event.text) {
        streamedText += event.text
        if (firstTokenAt === null) {
          firstTokenAt = timestamp
          console.info('[run-timing]', { runId, conversationId, turnId, phase: 'first_token', elapsedMs: timestamp - acceptedAt })
        }
      }
      eventBatcher.emit(fullEvent)
      return
    }
    // 本轮结束后基线快照没用了，留着只会一直占内存。
    if (projection.ledgerStatus) {
      clearRunBaselines(turnId)
      // 终态之后闸门没有意义；留着只会让同 id 的后续查询看到一个永远暂停的门。
      ctx.runPauseGates.delete(runId)
      // 台账收尾与 turn 状态同源；finishAgentRun 只认第一次终态，重复调用不会覆盖结局。
      ctx.store.finishAgentRun(namespace, runId, projection.ledgerStatus, event.detail ?? null, timestamp, event.errorKind ?? null)
    }
    // 写文件工具成功后主进程登记 Artifact 并广播，Artifacts 面板实时刷新。
    if (event.type === 'file_changed' && event.path) {
      const root = ctx.store.getConversationRoot(namespace, conversationId)
      ctx.registerArtifactForPath(namespace, conversationId, turnId, runId, root, event.path, event.detail)
    }
    const turn = ctx.store.getTurn(namespace, turnId)
    if (turn) {
      const activity = turn.activity ?? { status: 'working' as const, startedAt: turn.createdAt, finishedAt: null, events: [] }
      const write = resolveTurnWrite(projection, { turnStatus: turn.status, activityStatus: activity.status })
      const finalText = projection.terminal ? (fullEvent.text || '') : ''
      ctx.store.updateTurn(namespace, turnId, {
        // 事件副本不带 execution：顶层已存一份最新快照，逐条再存一份会让 activity 体积随事件数平方增长。
        // 轨迹正文按累计流式全文递增落库，不只认终态那一条：
        // 刷新或闪退时渲染进程的流式缓冲会没，只有库里这份能让轨迹里各动作后的说明文本继续显示。
        activity: { ...activity, status: write.activityStatus, finishedAt: projection.terminal ? new Date().toISOString() : activity.finishedAt, events: [...activity.events, persistableEvent(fullEvent)], thinking: thinkingText || activity.thinking, thinkingSegments: thinkingSegments.length ? [...thinkingSegments] : activity.thinkingSegments, transcript: streamedText || activity.transcript, execution },
        status: write.turnStatus,
        assistantMessage: finalText ? { text: finalText, createdAt: new Date().toISOString() } : undefined
      }, turn)
    }
    eventBatcher.emit(fullEvent)
  }
  ctx.store.startAgentRun(namespace, { runId, conversationId, turnId, mode, startedAt: acceptedAt })
  emit({ type: 'run_started', phase: 'queued', detail: '请求已接收，正在排队', status: 'running' })
  try {
    if (!modelId) throw new Error('未选择可用模型')
    if (signal.aborted) throw new DOMException('已取消', 'AbortError')
    const credentials = ctx.resolveModelCredentials(modelId)
    // session 按会话共用，换模型直接接着跑，完整历史（含工具调用）都在。
    // 只有跨协议才需要兜底：旧消息里的不透明内容（Anthropic 的 thinking 签名块等）
    // 不保证能被另一套协议接受，那时先把既有回合固化为摘要再重开 session。
    // 同协议换 provider 已实测可以直接续跑，不必白烧一次摘要调用、也不必丢掉工具调用细节。
    const nextProtocol = resolveModelProtocol(credentials.protocol, credentials.provider)
    // 解析不出此前任一模型的协议（模型被删、凭证没同步）时按 null 传，保守重开。
    const priorProtocols = ((): LocalModelApi[] | null => {
      const ids = ctx.store.listRuntimeModelIds(namespace, conversationId)
      const protocols: LocalModelApi[] = []
      for (const id of ids) {
        try {
          const prior = ctx.resolveModelCredentials(id)
          protocols.push(resolveModelProtocol(prior.protocol, prior.provider))
        } catch {
          return null
        }
      }
      return protocols
    })()
    if (needsSessionRebuild(priorProtocols, nextProtocol)) {
      const turns = ctx.store.listTurns(namespace, conversationId)
      const historyBeforeCurrentTurn = turns.filter((turn) => turn.id !== turnId)
      if (historyBeforeCurrentTurn.length && !ctx.latestSummaryText(namespace, conversationId)) {
        const switchPolicy = resolvePolicy(ctx.settings, ctx.store.getContextPolicy(namespace, conversationId), conversationId)
        const canCompact = splitTurns(turns, switchPolicy.keepRecentTurns).compressible.length > 0
        if (canCompact) {
          emit({ type: 'run_phase', phase: 'compacting', detail: '正在为新模型准备会话上下文', status: 'running' })
          const switched = await ctx.compactConversation(namespace, conversationId, 'model-switch', credentials)
          if (switched) emit({ type: 'compactionCompleted', context: switched.context, compaction: switched.compaction, detail: '新模型上下文已准备完成', status: 'completed' })
        }
      }
    }
    const policy = resolvePolicy(ctx.settings, ctx.store.getContextPolicy(namespace, conversationId), conversationId)
    // 阈值压缩全部交给 Pi：它在 session.prompt() 之前就用真实 usage 判过一次，
    // app 层再按回合历史估算判一次只会与之打架，还会作废 Pi 已经压好的 session。
    // Pi 本轮是否已经压过。压过就不再叠加桌面侧的阈值兜底，否则一轮里压两次。
    let sawRuntimeCompaction = false
    const recordRuntimeCompaction: NonNullable<RuntimeRunOptions['onCompaction']> = (event) => {
      sawRuntimeCompaction = true
      const recorded = ctx.recordSessionCompaction(namespace, conversationId, {
        triggerReason: `pi-${event.reason}`,
        strategy: policy.strategy,
        outcome: event,
        modelId
      })
      emit({ type: 'compactionCompleted', context: recorded.context, compaction: recorded.compaction, detail: '会话内上下文压缩完成', status: 'completed' })
    }
    if (signal.aborted) throw new DOMException('已取消', 'AbortError')
    emit({ type: 'run_phase', phase: 'initializing', detail: '正在准备本地运行时', status: 'running' })
    // cwd 只由会话归属决定：未归属会话不得继承界面上「当前打开的工作区」。
    // 未归属时落到固定的快速工作区，而不是 pi 默认的 process.cwd()——那是应用安装目录。
    const conversationRoot = ctx.store.getConversationRoot(namespace, conversationId) ?? ctx.appPaths.quickWorkspaceDir
    const agentContext = mode === 'agent' ? readAgentContextFiles({ projectRoot: conversationRoot }) : { files: [], errors: [] }
    if (agentContext.errors.length) console.warn(`[agent-context] ${agentContext.errors.length} 个指令文件读取失败`)
    const agentContextPrompt = mode === 'agent'
      ? mergeAgentContextFiles(agentContext.files, buildFaDirectoryContext(ctx.appPaths))
      : ''
    // Windows 上 WSL stub 会让 bash 工具全线报错：这里先探测可用 bash，
    // 探测不到（或用户显式配置的路径不可用）就整轮降级到 powershell。
    // 记忆召回拼在本轮输入之前，绝不能并进 agentContextPrompt：那份内容参与下面的运行时缓存
    // signature，逐轮变化会让每一轮都重建运行时（重连 MCP、重建沙箱）。
    const memorySettings = ctx.settings.memory
    const memoryProjectId = ctx.store.getConversation(namespace, conversationId)?.projectId ?? null
    const recalled = memorySettings.enabled
      ? recallMemories(ctx.store, { namespace, workspaceId: memoryProjectId, text: prompt, maxRecall: memorySettings.maxRecall })
      : { hits: [], prompt: '' }
    // 召回命中落日志表：会话内闭环要能回答「这一轮注入了什么」。失败不影响主流程。
    if (recalled.hits.length) {
      try { ctx.store.recordMemoryRecalls(namespace, conversationId, turnId, recalled.hits.map((hit) => hit.memory.id)) } catch (error) { console.warn('[memory] 召回日志写入失败:', error) }
    }
    // 项目知识库检索：与记忆同层注入（拼在本轮输入前），查询计划复用记忆的同一套分词。
    let kbPrompt = ''
    let kbEntries: KbEntry[] = []
    if (memoryProjectId) {
      try {
        const kbPlan = buildMemoryQueryPlan(prompt)
        if (!isEmptyQueryPlan(kbPlan)) {
          kbEntries = ctx.store.searchKbEntries(namespace, memoryProjectId, kbPlan, 3)
          kbPrompt = renderKbPrompt(kbEntries)
        }
      } catch (error) { console.warn('[kb] 知识库检索失败:', error) }
    }
    const effectivePrompt = withMemoryPrompt(`${kbPrompt ? `${kbPrompt}\n\n` : ''}${prompt}`, recalled.prompt)
    const bashPath = resolveBashPath({ explicitPath: ctx.settings.bashPath, bundledPath: ctx.bundledTools.bash }) ?? undefined
    const shellToolName = resolveShellToolName(ctx.settings.shellPreference, { explicitPath: ctx.settings.bashPath, bundledPath: ctx.bundledTools.bash })
    let allowedAbilities: Ability[] = []
    let mcpConfigs: ReturnType<LocalStore['listEnabledMcpRuntimeConfigs']> = []
    // skill 与 MCP 两种模式都加载（chat 只有 read/MCP，没有写类工具）；
    // Agent 可见能力统一从策略入口解析。
    allowedAbilities = resolveAgentAbilities(ctx.settings.agentAbilityPolicy, await ctx.listAbilities())
    const allowedMcpIds = new Set(allowedAbilities.filter((ability) => ability.type === 'mcp').map((ability) => ability.id))
    mcpConfigs = ctx.store.listEnabledMcpRuntimeConfigs().filter((config) => allowedMcpIds.has(config.id))
    // 本轮上下文来源落库：知识条目、可选中的 Skill、注入的规则文件。
    // 与记忆召回日志同样的定位——运行结束后没有第二个地方能回答「这一轮用了什么」。失败不影响主流程。
    try {
      const skillRevisions = new Map(allowedAbilities
        .filter((ability) => ability.type === 'skill' && ability.enabled)
        .map((ability) => [ability.id, ctx.store.latestSkillRevision(ability.id)] as const))
      ctx.store.recordTurnContextSources(namespace, conversationId, turnId, buildTurnContextSources({ kbEntries, abilities: allowedAbilities, ruleFiles: agentContext.files, skillRevisions }))
    } catch (error) { console.warn('[context] 上下文来源写入失败:', error) }
    const signature = createHash('sha256').update(JSON.stringify({
      namespace,
      conversationId,
      conversationRoot,
      mode,
      credentials,
      shellToolName,
      abilities: allowedAbilities.map((ability) => ({ type: ability.type, id: ability.id, enabled: ability.enabled, filePath: 'filePath' in ability ? ability.filePath : undefined })),
      mcpConfigs,
      abilityPolicy: ctx.settings.agentAbilityPolicy,
      subAgentEnabled: ctx.settings.subAgentEnabled,
      // 自定义角色进的是 subagent 工具描述（即系统提示），改了必须重建运行时，
      // 否则新角色在当前会话里一直不可见。
      subAgents: ctx.settings.subAgentEnabled ? normalizeCustomSubAgents(ctx.settings.subAgents) : [],
      contextPolicy: policy,
      sandbox: mode === 'agent' ? ctx.settings.sandbox : null,
      agentContext: agentContext.files.map((file) => ({ path: file.path, content: file.content, truncated: file.truncated }))
    })).digest('hex')
    const bridge = createApprovalBridge(runId, emit, conversationRoot)
    // 必须定义在本轮作用域：运行时缓存的工厂只在 miss 时执行一次，把它写在工厂里会让
    // 第二轮起的委派继续用首轮的 emit / runId / turnId / signal / bridge。
    // 子运行的 signal 在「用户停止」和「子任务超时」两种情况下都会 abort，
    // 只有父运行的 signal 能区分：与 subagent-scheduler 判定超时的口径保持一致。
    const abortedTaskStatus = () => signal.aborted ? 'cancelled' as const : 'timeout' as const
    const executeSubAgent = async (task: ScheduledSubAgentTask, childSignal: AbortSignal, parentToolCallId: string): Promise<SubAgentResult> => {
      const config = resolveSubAgentConfig(task.agentId, normalizeCustomSubAgents(ctx.settings.subAgents))
      if (!config) throw new Error(`未知 Sub-agent：${task.agentId}`)
      const childRunId = randomUUID()
      let output = ''
      let forwarded = 0
      const forwardContext = { taskId: task.taskId, agentId: config.id, agentName: config.name, parentToolCallId, parentRunId: runId, subAgentRunId: childRunId }
      // 工具调用次数是子运行唯一能观测到的边界：pi 的轮次循环在 session.prompt() 内部，
      // SDK 也不提供上限选项，config 里那个 maxTurns 从来没有生效过。
      const childController = new AbortController()
      const forwardChildAbort = () => childController.abort()
      childSignal.addEventListener('abort', forwardChildAbort, { once: true })
      // 角色自己声明了就用角色的，否则跟随设置里的全局默认。
      const maxToolCalls = config.maxToolCalls ?? ctx.settings.subAgentMaxToolCalls
      let toolCalls = 0
      let toolCallLimitHit = false
      const childRuntimeOptions: RuntimeRunOptions = {
        // 角色指令走 modePrompt：buildModeRuntimePrompt 会把它渲染成独立的「用户补充提示词」
        // 段落，拼进 prompt 会让角色设定和具体任务糊成一段，指令边界消失。
        prompt: task.task,
        mode: 'agent', modePrompt: config.systemPrompt, planMode: true, credentials, createModelRuntime: ctx.createModelRuntimeForCredentials, thinkingLevel: config.thinkingLevel,
        autoCompaction: false, permission: 'ask', attachments: [], workspaceRoot: conversationRoot,
        signal: childController.signal, contextSummary: null, sessionFile: null, agentDir: ctx.appPaths.agentDir,
        namespace, conversationId, turnId, runId: childRunId, store: ctx.store, shellToolName, bashPath,
        resolveRuleSet: () => ctx.buildRuleSet(namespace, 'ask', false), sessionOverrides: new Map(), requestApproval: bridge.requestApproval,
        requestQuestion: bridge.requestQuestion, mcpBindings: [], sandbox: null,
        subAgentExecution: undefined,
        subAgentMetadata: { parentToolCallId, subAgentId: config.id, subAgentRunId: childRunId },
        customSubAgents: [],
        // 子 Agent 只读：planMode 只挡写文件与 shell，挡不住 todowrite —— 子运行与主运行共用
        // namespace/conversationId，不收窄工具就能覆盖主 Agent 的待办。
        toolAllowlist: config.tools,
        onEvent: (event) => {
          if (event.type === 'token' && event.text) output += event.text
          if (event.type === 'completed' && event.text) output = event.text
          if (event.type === 'tool_started') {
            toolCalls += 1
            if (toolCalls > maxToolCalls && !toolCallLimitHit) {
              toolCallLimitHit = true
              childController.abort()
            }
          }
          // 逐 token 转发会让每个增量都触发一次整轮 activity 落库与 IPC，主进程直接被顶死。
          const next = forwardSubAgentEvent(event, forwardContext, forwarded)
          if (!next) return
          if (!isSubAgentTerminalEvent(event.type)) forwarded += 1
          emit(next)
        }
      }
      const startedAt = Date.now()
      // 委派落台账：turn.activity 里的 subagent 事件够渲染，但查询、统计与重启后的状态收敛都要靠这张表。
      ctx.store.startAgentTask(namespace, {
        taskId: task.taskId, runId, conversationId, turnId, parentToolCallId,
        subAgentRunId: childRunId, agentId: config.id, agentName: config.name,
        goal: task.task.slice(0, 2_000), startedAt
      })
      const { createPiSessionRuntime } = await ctx.loadPiRuntime()
      let child: Awaited<ReturnType<typeof createPiSessionRuntime>> | null = null
      try {
        child = await createPiSessionRuntime(childRuntimeOptions)
        await child.run(childRuntimeOptions)
      } catch (error) {
        ctx.store.finishAgentTask(namespace, task.taskId, {
          status: childSignal.aborted ? abortedTaskStatus() : toolCallLimitHit ? 'timeout' : 'failed',
          error: toolCallLimitHit && !childSignal.aborted
            ? `Sub-agent 工具调用次数超过 ${maxToolCalls} 次上限`
            : error instanceof Error ? error.message : String(error)
        })
        throw error
      } finally {
        childSignal.removeEventListener('abort', forwardChildAbort)
        await child?.dispose()
      }
      const bounded = truncateSubAgentOutput(output)
      const handoff = parseSubAgentHandoff(bounded.output)
      // 触发工具上限时 pi 只发 cancelled 后正常返回，childSignal 并没有 abort：
      // 不单独判一次就会把被截断的子运行记成「已完成」。
      const limitExceeded = toolCallLimitHit && !childSignal.aborted
      const status = limitExceeded ? 'timeout' as const : childSignal.aborted ? abortedTaskStatus() : 'completed' as const
      const error = limitExceeded ? `Sub-agent 工具调用次数超过 ${maxToolCalls} 次上限` : undefined
      ctx.store.finishAgentTask(namespace, task.taskId, { status, summary: handoff?.goal?.slice(0, 500) ?? null, error: error ?? null })
      return { taskId: task.taskId, agentId: config.id, agentName: config.name, status, output: bounded.output, handoff, ...(error ? { error } : {}), truncated: bounded.truncated, startedAt, finishedAt: Date.now() }
    }
    const cacheKey = ctx.conversationRuntimeKey(namespace, conversationId)
    // 摘要种子只在这一轮从空 session 开始时注入，而且必须在拿运行时之前取：
    // 运行时一创建就会经 onSessionFile 把新 session 文件写回库里，之后再查 session_file 永远非空，
    // 种子就被吞掉了（/clear 之外的重开：删回合、重跑、换协议压缩后，模型会突然什么都不记得）。
    const seedSummary = ctx.store.getConversationSessionFile(namespace, conversationId) ? null : ctx.latestSummaryText(namespace, conversationId)
    const cached = await ctx.conversationRuntimeCache.getWithStatus(cacheKey, signature, async () => {
      let mcpManager: LocalMcpManager | null = null
      let mcpBindings: McpToolBinding[] = []
      let sandboxSession: SandboxSession | null = null
      let pi: PiSessionRuntime | null = null
      const sessionOverrides = new Map<string, ApprovalDecision>()
      try {
        // MCP 两种模式都桥接；沙箱只在 agent 模式创建。
        const [{ LocalMcpManager }, { createPiSessionRuntime }] = await Promise.all([ctx.loadMcpRuntime(), ctx.loadPiRuntime()])
        mcpManager = new LocalMcpManager(mcpConfigs)
        mcpBindings = await mcpManager.connect()
        for (const diag of mcpManager.diagnostics) {
          ctx.recordMcpStatus(diag.serverId, { ok: false, error: diag.error, tools: [], resourceCount: 0, promptCount: 0 })
        }
        if (mode === 'agent') {
          const sandboxPolicy = buildSandboxPolicy(ctx.settings.sandbox, conversationRoot)
          try {
            sandboxSession = await ctx.sandboxManager.createSession({ workspacePath: conversationRoot, policy: sandboxPolicy, shell: shellToolName })
          } catch (error) {
            const notice = describeSandboxError(error)
            emit(sandboxBlockedEvent(notice))
            throw new Error(notice.title)
          }
          if (sandboxPolicy.enabled && sandboxSession.isolation === 'unsandboxed') emit(sandboxDegradedEvent(SANDBOX_DEGRADED_NOTICE))
        }
        const sessionFile = ctx.store.getConversationSessionFile(namespace, conversationId)
        const runtimeOptions: RuntimeRunOptions = {
          prompt: effectivePrompt,
          mode,
          modePrompt,
          planMode,
          credentials,
          createModelRuntime: ctx.createModelRuntimeForCredentials,
          thinkingLevel,
          autoCompaction: policy.autoSummary && policy.strategy !== 'disabled',
          contextPolicy: policy,
          permission,
          attachments,
          workspaceRoot: conversationRoot,
          signal,
          // agent 模式才探测：chat 模式没有 shell 工具，给了也用不上
          verificationCommands: mode === 'agent' ? verificationCommandsFor(conversationRoot) : undefined,
          contextSummary: seedSummary,
          sessionFile,
          sessionDir: ctx.conversationSessionDir(namespace, conversationId),
          agentDir: ctx.appPaths.agentDir,
          agentContextPrompt,
          skillPaths: allowedAbilities.filter((ability): ability is SkillAbility => ability.type === 'skill').map((ability) => ability.filePath),
          mcpBindings,
          // MCP 桥接扩展随运行时创建一次并跨轮复用，必须经由 sink 转发到当前这一轮的
          // 去重窗口，直接捕获闭包会永远记在首轮上。
          onAbilityUsed: (type, id) => abilityUsageSink?.(type, id),
          onSessionFile: (path) => ctx.store.setConversationSessionFile(namespace, conversationId, path),
          onEvent: emit,
          onCompaction: recordRuntimeCompaction,
          onRetry: () => ctx.store.bumpAgentRunRetry(namespace, runId),
          retryLimits: { maxEmptyRetries: ctx.settings.limits.maxEmptyRetries, maxLengthContinuations: ctx.settings.limits.maxLengthContinuations },
          // 闸门按需创建：没人按过暂停就不产生任何等待开销。
          waitWhilePaused: (childSignal) => ctx.runPauseGates.get(runId)?.wait(childSignal),
          namespace,
          conversationId,
          turnId,
          runId,
          store: ctx.store,
          shellToolName,
          bashPath,
          resolveRuleSet: () => ctx.buildRuleSet(namespace, ctx.runPermissionOverrides.get(runId) ?? permission, ctx.settings.subAgentEnabled),
          resolveFullAccess: () => ctx.isFullAccessPermission(namespace, ctx.runPermissionOverrides.get(runId) ?? permission),
          sessionOverrides,
          requestApproval: bridge.requestApproval,
          requestQuestion: bridge.requestQuestion,
          sandbox: sandboxSession ? { manager: ctx.sandboxManager, session: sandboxSession } : null,
          subAgentExecution: ctx.settings.subAgentEnabled ? { execute: executeSubAgent } : undefined,
          customSubAgents: ctx.settings.subAgentEnabled ? normalizeCustomSubAgents(ctx.settings.subAgents) : []
        }
        pi = await createPiSessionRuntime(runtimeOptions)
        const cachedRuntime: CachedConversationRuntime = {
          pi,
          mcpManager,
          mcpBindings,
          sandboxSession,
          sessionOverrides,
          async dispose() {
            // 后台进程按会话存活，会话运行时一销毁就必须停掉，不能跨会话残留。
            stopBackgroundShells(namespace, conversationId)
            await pi?.dispose()
            await mcpManager?.close()
            if (sandboxSession) await ctx.sandboxManager.destroySession(sandboxSession).catch((error) => console.error('[sandbox] destroySession 失败:', error))
          }
        }
        return cachedRuntime
      } catch (error) {
        await pi?.dispose().catch(() => undefined)
        await mcpManager?.close().catch(() => undefined)
        if (sandboxSession) await ctx.sandboxManager.destroySession(sandboxSession).catch(() => undefined)
        throw error
      }
    })
    ctx.conversationRuntimeCache.retain(cacheKey)
    emit({ type: 'run_phase', phase: 'initializing', cacheHit: cached.cacheHit, detail: cached.cacheHit ? '已复用会话运行时' : '会话运行时已就绪', status: 'completed' })
    // 运行时创建（MCP 连接、沙箱、扩展加载）耗时期间用户可能已点停止：
    // 此时 signal 已 abort，consumeSession 里的 abort 监听还来不及注册，必须在这里拦截。
    if (signal.aborted) throw new DOMException('已取消', 'AbortError')
    const sessionFile = ctx.store.getConversationSessionFile(namespace, conversationId)
    await cached.value.pi.run({
        prompt: effectivePrompt,
        mode,
        modePrompt,
        planMode,
        credentials,
        thinkingLevel,
        autoCompaction: policy.autoSummary && policy.strategy !== 'disabled',
        contextPolicy: policy,
        permission,
        attachments,
        workspaceRoot: conversationRoot,
        signal,
        // 复用的运行时已经带着自己的 session，种子只在新建的这一次给。
        contextSummary: cached.cacheHit ? null : seedSummary,
        sessionFile,
        sessionDir: ctx.conversationSessionDir(namespace, conversationId),
        agentDir: ctx.appPaths.agentDir,
        agentContextPrompt,
        skillPaths: allowedAbilities.filter((ability): ability is SkillAbility => ability.type === 'skill').map((ability) => ability.filePath),
        mcpBindings: cached.value.mcpBindings,
        onAbilityUsed,
        onSessionFile: (path) => ctx.store.setConversationSessionFile(namespace, conversationId, path),
        // 记下本轮开始时 session 的位置：重跑这一轮要把上下文退回到这里。写失败不影响本轮，只是重跑时退回兜底路径。
        onSessionAnchor: (anchor) => {
          if (!anchor.sessionFile) return
          try { ctx.store.setTurnSessionAnchor(namespace, turnId, { sessionFile: anchor.sessionFile, leafId: anchor.leafId }) } catch (error) { console.warn('[rerun] 记录回合锚点失败:', error) }
        },
        onEvent: emit,
        onCompaction: recordRuntimeCompaction,
        onRetry: () => ctx.store.bumpAgentRunRetry(namespace, runId),
        namespace,
        conversationId,
        turnId,
        runId,
        store: ctx.store,
        shellToolName,
        bashPath,
        resolveRuleSet: () => ctx.buildRuleSet(namespace, ctx.runPermissionOverrides.get(runId) ?? permission, ctx.settings.subAgentEnabled),
        resolveFullAccess: () => ctx.isFullAccessPermission(namespace, ctx.runPermissionOverrides.get(runId) ?? permission),
        sessionOverrides: cached.value.sessionOverrides,
        requestApproval: bridge.requestApproval,
        requestQuestion: bridge.requestQuestion,
        sandbox: cached.value.sandboxSession ? { manager: ctx.sandboxManager, session: cached.value.sandboxSession } : null,
        // 复用缓存运行时时，subagent 工具从 toolRuntimeRef 现取执行桥与自定义列表：
        // 这两项必须逐轮下发，否则用的还是创建那一轮的闭包。
        subAgentExecution: ctx.settings.subAgentEnabled ? { execute: executeSubAgent } : undefined,
        customSubAgents: ctx.settings.subAgentEnabled ? normalizeCustomSubAgents(ctx.settings.subAgents) : []
      })
      // 压缩会改变有效消息树，必须从 Pi 当前 session 取快照，不能继续复用压缩前 usage。
      latestContextMeasurement = cached.value.pi.getContextMeasurement()
      ctx.rememberRuntimeMeasurement(namespace, conversationId, latestContextMeasurement)
      // 阈值兜底：Pi 只在「发下一条前」和「一轮内准备下一次回答前」判，
      // 且要有可信的 provider usage；这两个条件任一不满足，越过阈值的会话会一直挂在高位
      // 直到下一次发送才可能压缩，甚至直接撞上下文溢出。这里按桌面侧同一份测量再判一次。
      if (!signal.aborted) {
        const fallback = await compactIfOverThreshold({
          ctx, namespace, conversationId, policy, credentials,
          measurement: latestContextMeasurement, runtimeCompacted: sawRuntimeCompaction, emit
        })
        // 压缩改写了消息树，压缩前那份测量值整段作废。落库的新状态由 compactConversation 写好，
        // 清空后收尾时的 refreshContext 直接读库，不去碰可能已被作废的运行时。
        if (fallback.compacted) latestContextMeasurement = undefined
      }
      // 记忆抽取：一次性模型调用，不进会话历史，也不等它完成——用户的回合到此已经结束，
      // 抽取失败只记日志。userText 用原始输入，不能带上这一轮注入的记忆片段。
      if (memorySettings.enabled && memorySettings.autoExtract && !signal.aborted && streamedText.trim()) {
        // 抽取模型可以与会话模型不同（通常挑个更便宜的）。配置的模型已被删除时回落到会话模型，
        // 不因为一条失效配置整轮不抽。
        const extractionCredentials = memorySettings.extractModelId === null
          ? credentials
          : (() => { try { return ctx.resolveModelCredentials(memorySettings.extractModelId) } catch { return credentials } })()
        void extractMemories(ctx.store, async (extractionPrompt) => {
          const { promptModelOnce } = await ctx.loadPiRuntime()
          return promptModelOnce({ credentials: extractionCredentials, prompt: extractionPrompt, agentDir: ctx.appPaths.agentDir, createModelRuntime: ctx.createModelRuntimeForCredentials })
        }, { namespace, conversationId, turnId, runId, workspaceId: memoryProjectId, userText: prompt, assistantText: streamedText })
          .then((result) => {
            if (result.created.length || result.refreshedIds.length || result.supersededIds.length) ctx.mainWindow?.webContents.send('memories:changed')
          })
          .catch((error) => console.error('[memory] 抽取失败:', error))
      }
    if (process.env.FASTAGENT_LEGACY_PLACEHOLDER === '1') {
    ctx.requireClient()
    if (signal.aborted) throw new DOMException('已取消', 'AbortError')
    emit({ type: 'failed', detail: 'Pi 运行时适配器将在后端桌面凭据接口就绪后启用。', status: 'failed' })
    }
  } catch (error) {
    const classified = classifyRunError(error)
    if (classified.kind === 'cancelled') emit({ type: 'cancelled', detail: '已取消' })
    else {
      ctx.reportModelFailure(modelId, error, Date.now() - acceptedAt)
      emit({ type: 'failed', detail: classified.message, status: 'failed', errorKind: classified.kind })
    }
  } finally {
    breadcrumb('run', `finish ${runId}`)
    // 先摘牌再做清理：终态事件已经发给界面了，界面收到后可能马上发下一条，
    // 而清理里有 await；留在表里会让那一条撞上「该会话已有任务在运行」。
    ctx.activeRuns.delete(runId)
    await ctx.conversationRuntimeCache.release(ctx.conversationRuntimeKey(namespace, conversationId))
    // run 级授权与循环计数随任务结束一并清掉。
    ctx.runPermissionOverrides.delete(runId)
    emit({ type: 'run_phase', phase: 'cleanup', detail: '运行清理完成', status: 'completed' })
    // 一轮结束后重算并广播上下文用量：优先用 pi 会话基于 provider usage 的数字，
    // 而不是本地字符/4 估算，否则界面数字会一直远低于模型后台。
    emit({ type: 'contextUpdated', context: ctx.refreshContext(namespace, conversationId, undefined, undefined, latestContextMeasurement) })
    eventBatcher.dispose()
    console.info('[run-timing]', { runId, conversationId, turnId, phase: 'completed', elapsedMs: Date.now() - acceptedAt, firstTokenMs: firstTokenAt === null ? null : firstTokenAt - acceptedAt })
  }
}
