import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent
} from '@earendil-works/pi-coding-agent'
import type { Api, Message, Model } from '@earendil-works/pi-ai'
import type { AgentEvent, ApprovalDecision, ApprovalRequest, Attachment, ConversationMode, ConversationTurn, ModelCredentials, PermissionPreset, QuestionAnswer, QuestionItem, ThinkingLevel } from '../shared/types'
import type { PermissionAction, PermissionRuleSet } from '../shared/permission-rules'
import { buildModeRuntimePrompt } from '../renderer/mode-prompts'
import { buildSummarySourceText } from './context-manager'
import { mergeAgentContextFiles, readAgentContextFiles } from './agent-context'
import { ContextMeter, type ContextMeasurement } from './context-meter'
import type { LocalStore } from './local-store'
import type { McpToolBinding } from './mcp-manager'
import { createToolRuntimeExtension, modeSystemPrompt, type ToolRuntimeContext, type ToolRuntimeContextRef } from './agent/tool-runtime'
import type { SandboxManager } from './agent/sandbox/sandbox-manager'
import type { SandboxSession } from './agent/sandbox/sandbox-types'
import { createMcpBridgeExtension } from './mcp-bridge'
import { createStreamTextRepair } from './stream-text-repair'
import { createInlineThinkStream, createThinkTagSplitter, type ThinkPart, type ThinkStreamEvent } from './think-tags'
import { stripThinkBlocks } from '../shared/think-blocks'
import type { SubAgentToolContext } from './agent/tools/subagent'
import { suggestReadOnlyDecomposition } from './agent/subagent/subagent-decomposer'
import { createModelUsageCollector } from './model-usage'
import { resolveThinkingLevel } from '../shared/thinking-level'

const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_TOKENS = 8_192

function protocolForCredentials(credentials: Pick<ModelCredentials, 'provider' | 'protocol'>): NonNullable<ModelCredentials['protocol']> {
  // 旧缓存没有 protocol，只能识别历史协议值；新提供商名称不能再被当作协议。
  if (credentials.protocol) return credentials.protocol
  return credentials.provider === 'anthropic' || credentials.provider === 'openai-responses' || credentials.provider === 'openai'
    ? credentials.provider
    : 'openai'
}

function apiForProtocol(protocol: NonNullable<ModelCredentials['protocol']>) {
  if (protocol === 'anthropic') return 'anthropic-messages'
  if (protocol === 'openai-responses') return 'openai-responses'
  return 'openai-completions'
}

function modelId(provider: string, credentials: ModelCredentials) {
  return `desktop-${provider}-${credentials.id}`
}

function modelDefinition(provider: string, credentials: ModelCredentials) {
  const protocol = protocolForCredentials(credentials)
  const baseUrl = credentials.base_url || (protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')
  return {
    id: credentials.model_name,
    name: credentials.name,
    api: apiForProtocol(protocol),
    baseUrl,
    reasoning: Boolean(credentials.supports_thinking),
    thinkingLevelMap: credentials.thinking_level_map,
    input: ['text', ...(provider === 'multimodal' ? ['image'] : [])] as ('text' | 'image')[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: credentials.context_window || DEFAULT_CONTEXT_WINDOW,
    maxTokens: credentials.max_tokens || DEFAULT_MAX_TOKENS,
    samplingParams: credentials.temperature === undefined && !credentials.extra_body ? undefined : { ...(credentials.temperature === undefined ? {} : { temperature: credentials.temperature }), ...(credentials.extra_body || {}) },
    // 厂商兼容配置（thinkingFormat / maxTokensField 等）直接透传给 pi 模型定义
    compat: credentials.compat ?? undefined
  }
}

function textFromMessage(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return stripThinkBlocks(content)
  if (!Array.isArray(content)) return ''
  const joined = content
    .filter((item): item is { type?: string; text?: string } => Boolean(item && typeof item === 'object'))
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text || '')
    // 多个文本块（工具调用打断等）用换行拼接：join('') 会把相邻块的 Markdown 标题/列表粘连成一行
    .join('\n')
  // 最终回答是从消息文本块重新取的原文，内联的 `<think>` 推理必须剥掉，否则它会跟着回答显示在折叠层外面。
  return stripThinkBlocks(joined)
}

function contentTextForContext(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((item): item is { type?: string; text?: string; thinking?: string } => Boolean(item && typeof item === 'object'))
    .map((item) => item.type === 'thinking' ? item.thinking || '' : item.type === 'text' ? item.text || '' : '')
    .filter(Boolean)
    .join('\n')
}

function jsonForContext(value: unknown): string {
  try { return JSON.stringify(value) }
  catch { return String(value ?? '') }
}

/** 按 Pi 当前真正送入模型的消息计算分类，总量优先采用 provider usage。 */
export function measureRuntimeContext(session: Pick<AgentSession, 'systemPrompt' | 'messages' | 'getContextUsage'>, credentials: Pick<ModelCredentials, 'id' | 'provider' | 'context_window'>): ContextMeasurement {
  const userParts: string[] = []
  const assistantParts: string[] = []
  const summaries: string[] = []
  const attachments: string[] = []
  const tools: Array<{ name: string; input?: string; result?: string }> = []
  for (const raw of session.messages as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const message = raw as { role?: string; content?: unknown; summary?: string; command?: string; output?: string }
    if (message.role === 'user' || message.role === 'custom') {
      userParts.push(contentTextForContext(message.content))
      if (Array.isArray(message.content)) {
        for (const block of message.content) if (block && typeof block === 'object' && (block as { type?: string }).type === 'image') attachments.push('x'.repeat(4_800))
      }
    } else if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!block || typeof block !== 'object') continue
        const item = block as { type?: string; text?: string; thinking?: string; name?: string; arguments?: unknown }
        if (item.type === 'text' && item.text) assistantParts.push(item.text)
        else if (item.type === 'thinking' && item.thinking) assistantParts.push(item.thinking)
        else if (item.type === 'toolCall') tools.push({ name: item.name || 'tool', input: jsonForContext(item.arguments) })
      }
    } else if (message.role === 'toolResult') {
      tools.push({ name: 'toolResult', result: contentTextForContext(message.content) })
    } else if (message.role === 'bashExecution') {
      tools.push({ name: 'shell', input: message.command || '', result: message.output || '' })
    } else if (message.role === 'compactionSummary' || message.role === 'branchSummary') {
      summaries.push(message.summary || '')
    }
  }
  const usage = session.getContextUsage()
  return new ContextMeter().measure({
    modelId: credentials.id,
    provider: credentials.provider,
    contextWindow: usage?.contextWindow || credentials.context_window || DEFAULT_CONTEXT_WINDOW,
    systemPrompt: session.systemPrompt,
    summary: summaries.join('\n'),
    turns: [{ user: userParts.join('\n'), assistant: assistantParts.join('\n'), tools }],
    attachments,
    usage: usage?.tokens === null || usage?.tokens === undefined ? undefined : { inputTokens: usage.tokens }
  })
}

function imageParts(attachments: Attachment[]) {
  return attachments
    .filter((item) => item.localPath && item.type.startsWith('image/'))
    .map(async (item) => {
      const bytes = await readFile(item.localPath as string)
      return {
        type: 'image' as const,
        data: bytes.toString('base64'),
        mimeType: item.type
      }
    })
}

export interface RuntimeRunOptions {
  prompt: string
  mode: ConversationMode
  modePrompt: string
  /** 计划模式：本轮禁止写入类工具，只允许只读探查 */
  planMode: boolean
  credentials: ModelCredentials
  createModelRuntime?: (credentials: ModelCredentials) => Promise<{ runtime: ModelRuntime; model: Model<Api> }>
  thinkingLevel: ThinkingLevel
  thinkingEnabled?: boolean
  autoCompaction?: boolean
  permission: PermissionPreset | null
  attachments: Attachment[]
  workspaceRoot: string | null
  signal: AbortSignal
  contextSummary?: string | null
  sessionFile?: string | null
  sessionDir?: string
  /** 桌面应用私有的 agent 配置目录；用空目录隔离 pi CLI 的全局扩展/skills/settings */
  agentDir: string
  onSessionFile?: (path: string) => void
  onEvent: (event: Omit<AgentEvent, 'runId'>) => void
  /** Pi 会话内压缩完成后同步给桌面持久层。 */
  onCompaction?: (event: { reason: 'manual' | 'threshold' | 'overflow'; tokensBefore: number; estimatedTokensAfter: number; durationMs: number; measurement: ContextMeasurement }) => void
  /** 运行时内部自动重试时回调一次，供调用方把次数记进台账；不影响重试本身。 */
  onRetry?: (reason: 'empty-response' | 'length-continuation') => void
  // Agent Tool Runtime（Phase 1）
  namespace: string
  conversationId: string
  turnId: string
  runId: string
  store: LocalStore
  shellToolName: 'bash' | 'powershell'
  /** Windows 上已探测可用的 bash 路径；shellToolName 为 powershell 或非 Windows 时为空 */
  bashPath?: string
  /** 现取规则集：运行途中改权限档位要立刻生效，不能在 run 开始时定死。 */
  resolveRuleSet: () => PermissionRuleSet
  sessionOverrides: Map<string, ApprovalDecision>
  requestApproval: (input: Omit<ApprovalRequest, 'id'>, signal: AbortSignal, recheck?: () => PermissionAction) => Promise<ApprovalDecision>
  requestQuestion: (toolCallId: string, questions: QuestionItem[], signal: AbortSignal) => Promise<QuestionAnswer[]>
  /** 显式启用的本地 Skill 的 SKILL.md 路径列表 */
  skillPaths?: string[]
  /** 本地 MCP Server 发现并桥接进来的工具 */
  mcpBindings?: McpToolBinding[]
  /** 本轮用到了哪些能力；调用方按轮去重后落库，供概览页「最近使用」 */
  onAbilityUsed?: (type: 'skill' | 'mcp', id: string) => void
  /** Agent 命令执行的沙箱上下文；null 表示以当前用户身份执行 */
  sandbox?: { manager: SandboxManager | null; session: SandboxSession | null } | null
  /** FastAgent 显式读取的全局与项目指令，避免依赖 Pi 的磁盘自动发现。 */
  agentContextPrompt?: string
  /** 主 Agent 委派只读 Sub-agent 的执行桥；子运行不再注入该字段，防止递归。 */
  subAgentExecution?: SubAgentToolContext & { parentToolCallId?: string; subAgentId?: string; subAgentRunId?: string }
  subAgentMetadata?: { parentToolCallId: string; subAgentId: string; subAgentRunId: string }
  customSubAgents?: import('./agent/subagent/subagent-types').SubAgentConfig[]
  /** 收窄内置工具白名单：Sub-agent 子运行据此限成只读，避免子 Agent 覆盖主 Agent 待办等状态。 */
  toolAllowlist?: string[]
  /** 工作区探测到的验证命令；进系统提示并豁免死循环守卫。 */
  verificationCommands?: readonly import('./agent/verification').VerificationCommand[]
}

export function toolNamesForMode(mode: ConversationMode, shellToolName: 'bash' | 'powershell'): string[] {
  // chat 也保留 read：skill 是按需用 read 加载 SKILL.md 的，没有 read 加载了也无法展开。
  return mode === 'chat'
    ? ['read']
    : ['read', 'grep', 'find', 'ls', 'edit', 'write', 'question', 'todowrite', 'patch', shellToolName, 'subagent']
}

/**
 * pi 的 tools 参数是严格白名单：MCP 桥接注册的 mcp__* 不加进来会被整体禁用。
 * toolAllowlist 只收窄内置工具（Sub-agent 子运行按 SubAgentConfig.tools 限成只读），
 * MCP 工具另有 allowMcp 一路控制，不参与这层交集。
 */
export function resolveEnabledTools(mode: ConversationMode, shellToolName: 'bash' | 'powershell', options: {
  subAgentEnabled: boolean
  mcpToolNames?: string[]
  toolAllowlist?: string[]
}): string[] {
  const allowlist = options.toolAllowlist ? new Set(options.toolAllowlist) : null
  const builtin = toolNamesForMode(mode, shellToolName)
    .filter((tool) => tool !== 'subagent' || options.subAgentEnabled)
    .filter((tool) => !allowlist || allowlist.has(tool))
  return [...builtin, ...(options.mcpToolNames ?? [])]
}

// 文本附件的跨文件总字符预算：多附件全量 prompt 会膨胀到失控，这里按顺序累加，溢出即截断后续文件。
export const ATTACHMENT_TEXT_BUDGET = 200_000
// 单文件硬上限：单个附件最多占用多少字符，避免一个超大文件吃掉所有预算。
const ATTACHMENT_PER_FILE_LIMIT = 100_000
const TEXT_ATTACHMENT_EXT_RE = /\.(txt|md|markdown|json|jsonc|csv|tsv|log|ini|toml|cfg|conf|properties|xml|html|css|scss|less|sql|sh|bash|ps1|bat|ts|tsx|js|jsx|mjs|cjs|vue|svelte|py|rb|go|rs|java|kt|kts|scala|groovy|gradle|c|h|cc|cpp|hpp|cs|php|swift|m|mm|dart|lua|r|pl|yaml|yml)$/i

function isTextAttachment(item: Attachment) {
  return Boolean(item.localPath) && !item.type.startsWith('image/') && TEXT_ATTACHMENT_EXT_RE.test(item.name)
}

/** 读取文本附件并按总预算截断：超过预算的文件整段丢弃，连分隔符都不计入 prompt。 */
export async function loadAttachmentInput(attachments: Attachment[], budget = ATTACHMENT_TEXT_BUDGET): Promise<{ textContext: string; textCharacters: number }> {
  const blocks: string[] = []
  let consumed = 0
  // 并行读取所有文本附件，按读出顺序填充预算；读取失败的文件直接跳过，避免阻塞。
  const reads = await Promise.all(attachments
    .filter(isTextAttachment)
    .map(async (item) => {
      try {
        const content = await readFile(item.localPath as string, 'utf8')
        return { name: item.name, content }
      } catch {
        return null
      }
    }))
  for (const entry of reads) {
    if (!entry) continue
    const limit = Math.min(entry.content.length, ATTACHMENT_PER_FILE_LIMIT)
    if (consumed + limit > budget) {
      const remaining = budget - consumed
      if (remaining <= 0) continue
      blocks.push(`\n\n--- ${entry.name} ---\n${entry.content.slice(0, remaining)}`)
      consumed += remaining
      continue
    }
    blocks.push(`\n\n--- ${entry.name} ---\n${entry.content.slice(0, limit)}`)
    consumed += limit
  }
  return { textContext: blocks.join(''), textCharacters: consumed }
}

async function textAttachmentContext(attachments: Attachment[]) {
  const result = await loadAttachmentInput(attachments)
  return result.textContext
}

export async function createModelRuntime(credentials: ModelCredentials) {
  const providerId = modelId(credentials.provider, credentials)
  const protocol = protocolForCredentials(credentials)
  const runtime = await ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false })
  runtime.registerProvider(providerId, {
    name: credentials.name,
    api: apiForProtocol(protocol),
    apiKey: credentials.api_key ?? '',
    baseUrl: credentials.base_url || (protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'),
    headers: credentials.headers,
    models: [modelDefinition(credentials.model_kind || 'chat', credentials)]
  })
  const model = runtime.getModel(providerId, credentials.model_name)
  if (!model) throw new Error('无法创建所选模型')
  return { runtime, model }
}

export function createRuntimeSettingsManager(cwd: string, agentDir: string, compactionEnabled = true): SettingsManager {
  const settingsManager = SettingsManager.create(cwd, agentDir)
  // 桌面层只能按应用回合压缩；启用自动摘要时，单个长回合中的工具消息由 Pi 在循环内部压缩。
  settingsManager.applyOverrides({ compaction: { enabled: compactionEnabled } })
  return settingsManager
}

const SUMMARY_INSTRUCTION = [
  '你是会话上下文压缩器。把下面的历史回合压缩成结构化摘要，供后续继续同一个任务时使用。',
  '严格按以下七个小节输出，每节用「- 」列出条目，无内容写「- —」，不要输出其他任何文字：',
  'Current goal',
  'User constraints',
  'Decisions',
  'Completed',
  'Open issues',
  'Important references',
  'Agent state',
  '保留任务目标、用户明确要求、已确认决策、已改文件与命令、未完成事项、错误与诊断、文件路径等关键引用。'
].join('\n')

/**
 * 一次性提示词调用：无工具、无历史、不落 session 文件，用完即弃。
 * 摘要与记忆抽取都属于这类「问一句拿一段文本」的旁路任务，不能走会话运行时，
 * 否则会把这些内部提示词写进用户会话历史。
 */
export async function promptModelOnce(options: { credentials: ModelCredentials; prompt: string; signal?: AbortSignal; agentDir?: string; createModelRuntime?: (credentials: ModelCredentials) => Promise<{ runtime: ModelRuntime; model: Model<Api> }> }): Promise<string> {
  const { runtime, model } = await (options.createModelRuntime ?? createModelRuntime)(options.credentials)
  const cwd = process.cwd()
  const agentDir = options.agentDir ?? join(tmpdir(), 'fastagent-agent')
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    settingsManager: createRuntimeSettingsManager(cwd, agentDir),
    model,
    modelRuntime: runtime,
    sessionManager: SessionManager.inMemory(cwd),
    tools: [],
    thinkingLevel: 'off' as never
  })
  let answer = ''
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type !== 'agent_end') return
    const last = [...event.messages].reverse().find((message) => (message as { role?: string }).role === 'assistant')
    answer = textFromMessage(last)
  })
  const abort = () => { void session.abort() }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    await session.prompt(options.prompt)
    return answer.trim()
  } finally {
    options.signal?.removeEventListener('abort', abort)
    unsubscribe()
    session.dispose()
  }
}

/** 调用会话所用模型生成结构化摘要格式。失败由调用方回退到本地启发式摘要。 */
export async function summarizeTurns(options: { credentials: ModelCredentials; turns: ConversationTurn[]; previousSummary?: string | null; signal?: AbortSignal; agentDir?: string; createModelRuntime?: (credentials: ModelCredentials) => Promise<{ runtime: ModelRuntime; model: Model<Api> }> }): Promise<string> {
  const summary = await promptModelOnce({
    credentials: options.credentials,
    prompt: `${SUMMARY_INSTRUCTION}\n\n${buildSummarySourceText(options.turns, options.previousSummary)}`,
    signal: options.signal,
    agentDir: options.agentDir,
    createModelRuntime: options.createModelRuntime
  })
  if (!summary) throw new Error('摘要生成结果为空')
  return summary
}

/** 摘要生成与 agent 运行共用的隔离配置：只加载内联 tool-runtime 扩展，不读 pi CLI 的全局扩展/skills/prompts。 */
export function createDesktopResourceLoader(options: { cwd: string; agentDir: string; settingsManager: SettingsManager; mode?: ConversationMode; toolRuntime?: ToolRuntimeContext | ToolRuntimeContextRef; skillPaths?: string[]; mcpBindings?: McpToolBinding[]; agentContextPrompt?: string; onAbilityUsed?: (type: 'skill' | 'mcp', id: string) => void }) {
  const currentToolRuntime = options.toolRuntime && 'current' in options.toolRuntime ? options.toolRuntime.current : options.toolRuntime
  const mode = options.mode ?? currentToolRuntime?.mode ?? 'chat'
  const agentMode = mode === 'agent'
  const agentContext = agentMode
    ? options.agentContextPrompt?.trim() || mergeAgentContextFiles(readAgentContextFiles({ projectRoot: options.cwd }).files)
    : ''
  return new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: options.settingsManager,
    // 桌面应用是独立产品：noExtensions/noSkills/noPromptTemplates 隔离用户机器上 pi CLI 的
    // 全局扩展（如 plan-mode）与 190+ 技能，避免它们改写工具集或注入外部指令。
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    // 桌面端显式控制指令文件，避免 Pi 自动发现造成重复注入或读取 agentDir 内容。
    noContextFiles: true,
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    systemPrompt: agentMode && agentContext ? `${modeSystemPrompt(mode)}\n\n${agentContext}` : modeSystemPrompt(mode),
    // skill 两种模式都要加载：描述进系统提示，正文由模型用 read 按需拉取。
    additionalSkillPaths: options.skillPaths?.length ? options.skillPaths : undefined,
    // chat 也挂 tool-runtime（read/mcp 的权限拦截在扩展里），MCP 桥接随绑定存在而挂。
    extensionFactories: options.toolRuntime || options.mcpBindings?.length
      ? [
          ...(options.toolRuntime ? [{ name: 'fastagent-tool-runtime', factory: createToolRuntimeExtension(options.toolRuntime) }] : []),
          ...(options.mcpBindings?.length ? [{ name: 'fastagent-mcp-bridge', factory: createMcpBridgeExtension(options.mcpBindings, options.onAbilityUsed) }] : [])
        ]
      : []
  })
}

function toolRuntimeContext(options: RuntimeRunOptions): ToolRuntimeContext {
  return {
    namespace: options.namespace,
    conversationId: options.conversationId,
    turnId: options.turnId,
    runId: options.runId,
    cwd: options.workspaceRoot || process.cwd(),
    mode: options.mode,
    planMode: options.planMode,
    shellToolName: options.shellToolName,
    bashPath: options.bashPath,
    resolveRuleSet: options.resolveRuleSet,
    sessionOverrides: options.sessionOverrides,
    store: options.store,
    emit: options.onEvent,
    signal: options.signal,
    requestApproval: options.requestApproval,
    requestQuestion: options.requestQuestion,
    mcpToolRisk: new Map((options.mcpBindings ?? []).map((binding) => [binding.name, binding.risk])),
    sandbox: options.sandbox ?? null,
    subAgent: options.subAgentExecution,
    subAgentMetadata: options.subAgentMetadata,
    customSubAgents: options.customSubAgents,
    verificationCommands: options.verificationCommands,
    skillManifestPaths: options.skillPaths,
    onAbilityUsed: options.onAbilityUsed
  }
}

export interface PiSessionRuntime {
  modelRuntime: ModelRuntime
  settingsManager: SettingsManager
  resourceLoader: DefaultResourceLoader
  sessionManager: SessionManager
  session: AgentSession
  toolRuntimeRef: ToolRuntimeContextRef | null
  run(options: RuntimeRunOptions): Promise<void>
  getContextMeasurement(): ContextMeasurement
  dispose(): Promise<void>
}

export async function createPiSessionRuntime(options: RuntimeRunOptions): Promise<PiSessionRuntime> {
  const { runtime, model } = await (options.createModelRuntime ?? createModelRuntime)(options.credentials)

  const cwd = options.workspaceRoot || process.cwd()
  // 工具集不再随权限档位变化：能力差异全部交给 Permission Engine。
  // shell 定义仍由 tool-runtime 注入沙箱后端，但也必须进入 Pi 最终启用白名单。
  const tools = resolveEnabledTools(options.mode, options.shellToolName, {
    subAgentEnabled: Boolean(options.subAgentExecution),
    mcpToolNames: (options.mcpBindings ?? []).map((binding) => binding.name),
    toolAllowlist: options.toolAllowlist
  })

  const sessionManager = options.sessionDir
    ? options.sessionFile && existsSync(options.sessionFile)
      ? SessionManager.open(options.sessionFile, options.sessionDir, cwd)
      : SessionManager.create(cwd, options.sessionDir)
    : SessionManager.inMemory(cwd)
  // session 按会话共用，换模型时在历史里留一条 model_change：pi 靠它标记这一段由哪个模型产出。
  // 已有历史但读不到模型的旧 session 同样补一条，否则新模型接手的位置无从分辨。
  const sessionProviderId = modelId(options.credentials.provider, options.credentials)
  const sessionModel = sessionManager.buildSessionContext().model
  const modelChanged = !sessionModel || sessionModel.provider !== sessionProviderId || sessionModel.modelId !== options.credentials.model_name
  if (modelChanged && sessionManager.getEntries().length) sessionManager.appendModelChange(sessionProviderId, options.credentials.model_name)
  const settingsManager = createRuntimeSettingsManager(cwd, options.agentDir, options.autoCompaction !== false)
  // 超时/重试按当前模型的凭证注入：运行时每轮新建，互不覆盖，云端模型下发同样生效。
  if (options.credentials.timeout || options.credentials.max_retries) {
    settingsManager.applyOverrides({
      retry: {
        provider: {
          timeoutMs: options.credentials.timeout ? options.credentials.timeout * 1000 : undefined,
          maxRetries: options.credentials.max_retries
        }
      }
    })
  }
  const toolRuntimeRef: ToolRuntimeContextRef | null = { current: toolRuntimeContext(options) }
  const resourceLoader = createDesktopResourceLoader({
    cwd,
    agentDir: options.agentDir,
    settingsManager,
    mode: options.mode,
    skillPaths: options.mode === 'agent' ? options.skillPaths : undefined,
    // MCP 两种模式都桥接：index.ts 侧两模式都会连接并传入绑定，这里不能按模式截断，
    // 否则 chat 模式模型拿不到搜索等 MCP 工具。
    mcpBindings: options.mcpBindings,
    agentContextPrompt: options.agentContextPrompt,
    onAbilityUsed: options.onAbilityUsed,
    toolRuntime: toolRuntimeRef ?? undefined
  })
  await resourceLoader.reload()
  const extensionErrors = resourceLoader.getExtensions().errors
  if (extensionErrors.length) {
    throw new Error(`Agent 工具扩展加载失败：${extensionErrors.map((item) => String(item.error)).join('；')}`)
  }
  const effectiveThinkingLevel = resolveThinkingLevel(options.thinkingLevel, options.credentials)
  const { session } = await createAgentSession({
    cwd,
    agentDir: options.agentDir,
    model,
    modelRuntime: runtime,
    sessionManager,
    settingsManager,
    resourceLoader,
    tools,
    thinkingLevel: effectiveThinkingLevel
  })
  // print 模式：无对话框 UI（ctx.hasUI = false），审批/提问走 IPC 通道
  await session.bindExtensions({ mode: 'print', onError: (error) => console.error('[tool-runtime]', error.extensionPath, error.event, error.error) })
  if (session.sessionFile && session.sessionFile !== options.sessionFile) options.onSessionFile?.(session.sessionFile)
  return {
    modelRuntime: runtime,
    settingsManager,
    resourceLoader,
    sessionManager,
    session,
    toolRuntimeRef,
    async run(runOptions) {
      if (toolRuntimeRef) toolRuntimeRef.current = toolRuntimeContext(runOptions)
      const nextThinkingLevel = resolveThinkingLevel(runOptions.thinkingLevel, runOptions.credentials)
      session.setThinkingLevel(nextThinkingLevel)
      await consumeSession(session, {
        ...runOptions,
        thinkingEnabled: Boolean(runOptions.credentials.supports_thinking && nextThinkingLevel !== 'off')
      })
    },
    getContextMeasurement() {
      return measureRuntimeContext(session, options.credentials)
    },
    async dispose() {
      if (!session.isIdle) await session.abort().catch(() => undefined)
      session.dispose()
    }
  }
}

export async function runPiSession(options: RuntimeRunOptions) {
  const runtime = await createPiSessionRuntime(options)
  try {
    await runtime.run(options)
  } finally {
    await runtime.dispose()
  }
}

export interface DirectChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface DirectChatOptions {
  prompt: string
  credentials: ModelCredentials
  createModelRuntime?: (credentials: ModelCredentials) => Promise<{ runtime: ModelRuntime; model: Model<Api> }>
  thinkingLevel: ThinkingLevel
  /** 历史回合（不含当前 prompt），按时间正序 */
  history: DirectChatTurn[]
  signal?: AbortSignal
  onToken?: (text: string) => void
  onThinking?: (text: string) => void
}

export interface DirectChatResult {
  text: string
  thinking: string
  stopReason: string
  usageTokens: number | null
  usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number } | null
}

/**
 * 快速对话直接调模型接口：不创建 AgentSession，跳过运行时初始化、工具与 MCP，
 * 换来最短首 token 时间。历史由调用方从持久会话拼好传入，上下文保留但不压缩。
 */
export async function runDirectChat(options: DirectChatOptions): Promise<DirectChatResult> {
  const { runtime, model } = await (options.createModelRuntime ?? createModelRuntime)(options.credentials)
  const protocol = protocolForCredentials(options.credentials)
  const providerId = modelId(options.credentials.provider, options.credentials)
  const messages: Message[] = options.history.map((turn) => turn.role === 'user'
    ? { role: 'user', content: turn.text, timestamp: 0 }
    : {
        role: 'assistant',
        content: [{ type: 'text', text: turn.text }],
        api: apiForProtocol(protocol) as Api,
        provider: providerId,
        model: options.credentials.model_name,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: 0
      })
  messages.push({ role: 'user', content: options.prompt, timestamp: Date.now() })
  // auto 解析到凭证默认档；不支持思考的模型强制 off，与运行时路径保持一致。
  const reasoning = resolveThinkingLevel(options.thinkingLevel, options.credentials)
  const stream = runtime.streamSimple(model, { messages }, { reasoning: reasoning === 'off' ? undefined : reasoning, signal: options.signal })
  let text = ''
  let thinking = ''
  // 与 Agent 路径同一套处理：正文里内联的 `<think>` 推理不能留在回答里。
  const thinkSplitter = createThinkTagSplitter()
  const takeParts = (parts: ThinkPart[]) => {
    for (const part of parts) {
      if (part.kind === 'thinking') { thinking += part.text; options.onThinking?.(part.text) }
      else { text += part.text; options.onToken?.(part.text) }
    }
  }
  try {
    for await (const event of stream) {
      if (event.type === 'text_delta' && event.delta) takeParts(thinkSplitter.push(event.delta))
      else if (event.type === 'thinking_delta' && event.delta) { thinking += event.delta; options.onThinking?.(event.delta) }
    }
    takeParts(thinkSplitter.flush())
  } catch (error) {
    // 遍历中断（含用户取消）同样走到这里：stream 已不可继续，直接转抛给调用方判定。
    throw error
  }
  const final = await stream.result()
  const stopReason = (final as { stopReason?: string }).stopReason
  if (stopReason === 'error' || stopReason === 'aborted') {
    if (options.signal?.aborted) throw new DOMException('已取消', 'AbortError')
    throw new Error((final as { errorMessage?: string }).errorMessage || '模型请求失败')
  }
  const finalText = text || textFromMessage(final)
  const usage = (final as { usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number } }).usage
  const usageTokens = usage ? usage.totalTokens || (usage.input || 0) + (usage.output || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0) : null
  return { text: finalText, thinking, stopReason: stopReason || 'stop', usageTokens, usage: usage ?? null }
}

export type RunOutcomeKind = 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'retry-empty'

export interface RunOutcome {
  kind: RunOutcomeKind
  text: string
  reason: string
}

/**
 * 根据 agent_end 携带的最后一条 assistant 消息判定本轮真实结局。
 * 长任务异常停止的根因之一是：任何 agent_end 都被当成「生成完成」，
 * 导致模型报错、输出被截断、空响应都被 UI 标记为 completed。这里把可判定的异常区分出来。
 */
export function shouldAutoContinueLength(last: unknown, limits: { contextWindow?: number | null; maxTokens?: number | null }, attempts: number): boolean {
  if (attempts >= 3 || !last || typeof last !== 'object') return false
  const message = last as { stopReason?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }
  if (message.stopReason !== 'length') return false
  const maxTokens = limits.maxTokens || DEFAULT_MAX_TOKENS
  const outputTokens = message.usage?.output || 0
  if (outputTokens < maxTokens * 0.95) return false
  const contextWindow = limits.contextWindow || DEFAULT_CONTEXT_WINDOW
  const inputTokens = (message.usage?.input || 0) + (message.usage?.cacheRead || 0) + (message.usage?.cacheWrite || 0)
  return contextWindow - inputTokens > 4_096 + Math.max(1_024, outputTokens)
}

export function classifyRunOutcome(last: unknown, limits: { contextWindow?: number | null; maxTokens?: number | null } = {}): RunOutcome {
  const message = (last ?? null) as { content?: unknown; stopReason?: string; errorMessage?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } } | null
  const text = textFromMessage(message)
  const stopReason = message?.stopReason ?? 'stop'
  const content = Array.isArray(message?.content) ? message.content : []
  const toolCalls = content.filter((item): boolean => Boolean(item && typeof item === 'object' && (item as { type?: string }).type === 'toolCall'))
  if (stopReason === 'aborted') return { kind: 'cancelled', text, reason: '已取消' }
  if (stopReason === 'error') return { kind: 'failed', text, reason: message?.errorMessage?.trim() || '模型响应异常' }
  if (stopReason === 'length') {
    const contextWindow = limits.contextWindow || 0
    const inputTokens = (message?.usage?.input || 0) + (message?.usage?.cacheRead || 0) + (message?.usage?.cacheWrite || 0)
    const outputTokens = message?.usage?.output || 0
    const remaining = contextWindow - inputTokens
    const contextPressure = contextWindow > 0 && remaining <= 4_096 + Math.max(1_024, outputTokens)
    if (contextPressure) {
      const percent = Math.min(100, Math.round(inputTokens / contextWindow * 100))
      return { kind: 'interrupted', text, reason: `上下文空间不足（约 ${percent}%），输出被提前截断` }
    }
    const maxTokens = limits.maxTokens || DEFAULT_MAX_TOKENS
    return { kind: 'interrupted', text, reason: `单次输出达到 ${maxTokens} token 上限，内容可能被截断` }
  }
  // 无正文且无工具调用的正常结束：模型没干任何事就停了（可能是空响应或只输出了空白），需要重试
  if (!text.trim() && toolCalls.length === 0) return { kind: 'retry-empty', text, reason: '模型响应意外结束（无内容）' }
  return { kind: 'completed', text, reason: '生成完成' }
}

function emitOutcome(outcome: RunOutcome, options: RuntimeRunOptions) {
  switch (outcome.kind) {
    case 'completed':
      options.onEvent({ type: 'completed', text: outcome.text, detail: outcome.reason, status: 'completed' })
      break
    case 'failed':
      options.onEvent({ type: 'failed', text: outcome.text, detail: outcome.reason, status: 'failed' })
      break
    case 'cancelled':
      options.onEvent({ type: 'cancelled', detail: outcome.reason })
      break
    case 'interrupted':
      options.onEvent({ type: 'interrupted', text: outcome.text, detail: outcome.reason, status: 'interrupted' })
      break
  }
}

export interface AssistantStreamMapping {
  events: Array<Omit<AgentEvent, 'runId'>>
  thinkingActive: boolean
}

/**
 * OpenAI 兼容通道要等整段流消费完才推 thinking_end，正文因此在渲染进程被扣到回合末尾一次性放出。
 * 首个正文增量即判定思考结束，与执行状态机按 assistant_content_started 收尾的判定保持一致。
 */
export function mapAssistantStreamEvent(
  event: { type: string; delta?: string },
  thinkingActive: boolean,
  repairText: (text: string) => string
): AssistantStreamMapping {
  const events: Array<Omit<AgentEvent, 'runId'>> = []
  let active = thinkingActive
  if (event.type === 'thinking_start' && !active) {
    active = true
    events.push({ type: 'thinking_started' })
  }
  if (event.type === 'text_delta') {
    if (active) {
      active = false
      events.push({ type: 'thinking_ended' })
    }
    events.push({ type: 'token', text: repairText(event.delta ?? '') })
  }
  if (event.type === 'thinking_delta') events.push({ type: 'thinking', text: repairText(event.delta ?? '') })
  if (event.type === 'thinking_end' && active) {
    active = false
    events.push({ type: 'thinking_ended' })
  }
  return { events, thinkingActive: active }
}

async function consumeSession(session: AgentSession, options: RuntimeRunOptions) {
  let thinkingActive = Boolean(options.thinkingEnabled)
  if (thinkingActive) options.onEvent({ type: 'thinking_started' })
  // 取消可能在 session.prompt 尚未把 agent 跑起来（扩展事件、鉴权检查）时到达：
  // 此时 Agent.abort() 没有 activeRun 可以中止，等 prompt 启动后取消就丢了。
  // 通过「任何 session 事件都复查 signal」兜底：一旦发现已取消就补一次 abort。
  let abortRequested = false
  const ensureAborted = () => {
    if (options.signal.aborted && !abortRequested) {
      abortRequested = true
      void session.abort().catch(() => undefined)
    }
  }
  if (options.signal.aborted) throw new DOMException('已取消', 'AbortError')
  // 网关分块可能把非 BMP 字符（旗帜 emoji 等）从代理对中间切开，进增量前拼回。
  const textRepair = createStreamTextRepair()
  // 正文里内联的 `<think>` 推理（部分 OpenAI 兼容通道不走 reasoning 字段）在这里剥出来。
  const inlineThink = createInlineThinkStream()
  const emitThinkEvents = (events: ThinkStreamEvent[]) => {
    for (const event of events) {
      if (event.type === 'thinking_started') thinkingActive = true
      if (event.type === 'thinking_ended') thinkingActive = false
      options.onEvent(event)
    }
  }
  // agent_end 时同步记录最终消息；session.prompt 返回时订阅回调早已跑完，直接读这两个变量判定结局。
  let sawAgentEnd = false
  let lastAssistantMessage: unknown = null
  let compactionStartedAt: number | null = null
  const collectUsage = createModelUsageCollector({
    conversationId: options.conversationId, turnId: options.turnId, runId: options.runId,
    modelId: options.credentials.id, provider: options.credentials.provider, modelName: options.credentials.model_name,
    baseUrl: options.credentials.base_url || (protocolForCredentials(options.credentials) === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'),
    subAgent: Boolean(options.subAgentMetadata)
  }, (usageRecord) => options.onEvent({ type: 'usageUpdated', usageRecord }))
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    // 取消也可能已经计费，必须先保存已返回的 usage，再执行中断分支。
    if (event.type === 'message_end') collectUsage(event.message)
    ensureAborted()
    if (event.type === 'compaction_start') {
      compactionStartedAt = Date.now()
      options.onEvent({ type: 'run_phase', phase: 'compacting', detail: event.reason === 'overflow' ? '上下文不足，正在压缩并恢复执行' : '长任务上下文正在自动压缩', status: 'running' })
      return
    }
    if (event.type === 'compaction_end') {
      const durationMs = compactionStartedAt === null ? 0 : Date.now() - compactionStartedAt
      compactionStartedAt = null
      if (event.result) {
        const measurement = measureRuntimeContext(session, options.credentials)
        try {
          options.onCompaction?.({ reason: event.reason, tokensBefore: event.result.tokensBefore, estimatedTokensAfter: event.result.estimatedTokensAfter ?? measurement.estimatedTokens, durationMs, measurement })
        } catch (error) {
          // 压缩已经在 Pi 内生效，桌面统计落库失败不能反过来中止 Agent 恢复。
          console.error('[runtime-compaction] 同步压缩记录失败:', error)
        }
        options.onEvent({ type: 'run_phase', phase: 'compacting', detail: event.willRetry ? '上下文压缩完成，正在恢复执行' : '长任务上下文压缩完成', status: 'completed' })
      } else {
        options.onEvent({ type: 'run_phase', phase: 'compacting', detail: event.errorMessage || (event.aborted ? '上下文压缩已取消' : '上下文压缩失败'), status: event.aborted ? 'cancelled' : 'failed' })
      }
      return
    }
    if (event.type === 'message_update') {
      // 已取消后不再向 UI 推增量，避免停止后流式内容继续出现
      if (options.signal.aborted) return
      const mapping = mapAssistantStreamEvent(event.assistantMessageEvent, thinkingActive, (text) => textRepair.push(text))
      thinkingActive = mapping.thinkingActive
      for (const mapped of mapping.events) {
        // 正文里内联的 `<think>` 推理要转到思考通道，否则它会原样进入最终回答且折叠层看不到。
        if (mapped.type === 'token' && mapped.text) { emitThinkEvents(inlineThink.push(mapped.text, thinkingActive)); continue }
        // 内联思考期间每块 text_delta 都会带一个 thinking_ended，那是原生思考的收尾判定，
        // 这里的思考什么时候结束由 `</think>` 说了算，转发出去只会把一段思考切碎。
        if (mapped.type === 'thinking_ended' && inlineThink.inThinking) continue
        options.onEvent(mapped)
      }
      return
    }
    if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
      // 工具生命周期事件已由 tool-runtime 扩展统一发出（含权限/耗时/工具调用记录），此处不再转发。
      return
    }
    if (event.type === 'agent_end') {
      emitThinkEvents(inlineThink.flush(thinkingActive))
      if (thinkingActive) {
        thinkingActive = false
        options.onEvent({ type: 'thinking_ended' })
      }
      // 中止触发的 agent_end（含 stopReason=aborted 的失败消息）按取消结算，
      // 否则用户点停止后主进程会把半截回复记成「生成完成」。
      if (options.signal.aborted) {
        options.onEvent({ type: 'cancelled', detail: '已取消' })
        sawAgentEnd = true
        return
      }
      sawAgentEnd = true
      lastAssistantMessage = [...event.messages].reverse().find((message) => (message as { role?: string }).role === 'assistant') ?? null
    }
  })
  options.signal.addEventListener('abort', ensureAborted, { once: true })
  try {
    const images = await Promise.all(imageParts(options.attachments))
    const attachmentContext = await textAttachmentContext(options.attachments)
    const basePrompt = buildModeRuntimePrompt(options.modePrompt, options.prompt, attachmentContext, options.contextSummary || '')
    const decomposition = options.mode === 'agent' ? suggestReadOnlyDecomposition(options.prompt) : { shouldDelegate: false, tasks: [] }
    const delegationHint = decomposition.shouldDelegate
      ? `\n\n【只读调查候选】\n${decomposition.tasks.map((task) => `- ${task.agentId}：${task.goal}`).join('\n')}\n这些只是候选，不要自动委派；仅在确实独立且能节省上下文时调用 subagent，并由你复核结果。`
      : ''
    const prompt = `${basePrompt}${delegationHint}`
    const promptArgs = images.length ? { images } : undefined
    const limits = { contextWindow: options.credentials.context_window || DEFAULT_CONTEXT_WINDOW, maxTokens: options.credentials.max_tokens || DEFAULT_MAX_TOKENS }
    const continuationPrompt = '输出令牌上限已到。直接从截断处继续，不要道歉、不要回顾、不要重复已完成内容；把剩余工作拆成更小步骤并持续更新待办。'
    // 空响应自动重试最多 2 次；真正吃满输出预算时自动续写最多 3 次。
    const MAX_EMPTY_RETRIES = 2
    let emptyRetries = 0
    let lengthContinuations = 0
    let nextPrompt = prompt
    let nextPromptArgs = promptArgs
    for (;;) {
      sawAgentEnd = false
      lastAssistantMessage = null
      try {
        await session.prompt(nextPrompt, nextPromptArgs)
      } catch (error) {
        emitThinkEvents(inlineThink.flush(thinkingActive))
        if (thinkingActive) {
          thinkingActive = false
          options.onEvent({ type: 'thinking_ended' })
        }
        if (options.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          options.onEvent({ type: 'cancelled', detail: '已取消' })
        } else {
          options.onEvent({ type: 'failed', detail: error instanceof Error ? error.message : '运行失败', status: 'failed' })
        }
        return
      }
      // session.prompt 正常返回但连 agent_end 都没收到：视为引擎层异常终止，绝不能标记完成。
      if (!sawAgentEnd) {
        if (options.signal.aborted) options.onEvent({ type: 'cancelled', detail: '已取消' })
        else options.onEvent({ type: 'interrupted', text: '', detail: 'Agent 循环意外终止', status: 'interrupted' })
        return
      }
      const outcome = classifyRunOutcome(lastAssistantMessage, limits)
      if (shouldAutoContinueLength(lastAssistantMessage, limits, lengthContinuations) && !options.signal.aborted) {
        lengthContinuations += 1
        nextPrompt = continuationPrompt
        nextPromptArgs = undefined
        options.onRetry?.('length-continuation')
        options.onEvent({ type: 'run_phase', phase: 'prompting', detail: `单次输出达到上限，正在自动续写（${lengthContinuations}/3）`, status: 'running' })
        continue
      }
      if (outcome.kind === 'retry-empty' && emptyRetries < MAX_EMPTY_RETRIES && !options.signal.aborted) {
        emptyRetries += 1
        options.onRetry?.('empty-response')
        options.onEvent({ type: 'run_phase', phase: 'prompting', detail: `模型返回空响应，自动重试（${emptyRetries}/${MAX_EMPTY_RETRIES}）`, status: 'running' })
        continue
      }
      emitOutcome(outcome, options)
      return
    }
  } finally {
    options.signal.removeEventListener('abort', ensureAborted)
    unsubscribe()
  }
}
