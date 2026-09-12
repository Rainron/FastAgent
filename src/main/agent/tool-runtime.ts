import type { ExtensionFactory, ExtensionHandler, ToolCallEvent, ToolCallEventResult, ToolResultEvent } from '@earendil-works/pi-coding-agent'
import { createBashToolDefinition, createPowerShellToolDefinition, isEditToolResult } from '@earendil-works/pi-coding-agent'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import type { AgentEvent, ApprovalDecision, ApprovalRequest, QuestionAnswer, QuestionItem } from '../../shared/types'
import { builtInModeSystemPrompts } from '../../shared/mode-prompts'
import type { PermissionAction, PermissionRuleSet } from '../../shared/permission-rules'
import { alwaysAllowPatterns, logicalToolKey, planModeAction } from '../../shared/permission-rules'
import type { LocalStore } from '../local-store'
import { matchPattern } from '../../shared/pattern-matcher'
import { resolvePermission } from './permission/permission-engine'
import { classifySecretPath, mergeSecretClassification, type SecretClassification } from './safety/secret-file-guard'
import { resolveToolPath, type ResolvedToolPath } from './safety/workspace-guard'
import { classifyOperation, diffSnapshots, missingSnapshot, snapshotFile, type FileSnapshot } from './file-ledger'
import { DoomLoopGuard } from './safety/doom-loop-guard'
import { guardToolText, MAX_STORED_SUMMARY_BYTES, truncateText } from './safety/output-guard'
import { createPatchTool } from './tools/patch'
import { createQuestionTool } from './tools/question'
import { createTodoTool } from './tools/todo'
import { createSubAgentTool } from './tools/subagent'
import type { SubAgentToolContext } from './tools/subagent'
import { createShellOperations } from './sandbox/shell-operations'
import { isVerificationCommand, verificationPrompt, type VerificationCommand } from './verification'
import type { SandboxManager } from './sandbox/sandbox-manager'
import type { SandboxSession } from './sandbox/sandbox-types'

export interface ToolRuntimeContext {
  namespace: string
  conversationId: string
  turnId: string
  runId: string
  cwd: string
  mode: 'chat' | 'agent'
  /** 计划模式：写入类工具在权限解析之外被硬拒绝，只允许只读探查 */
  planMode: boolean
  shellToolName: 'bash' | 'powershell'
  /** Windows 上已探测可用的 bash 路径；与 shellToolName 一起决定本地执行后端 */
  bashPath?: string
  /**
   * 每次工具调用现取规则集，不缓存。
   * 用户在运行途中切换权限档位时必须立刻生效——跑到一半发现权限不够、就地放开继续，
   * 是很自然的用法；把规则集在 run 开始时定死，用户改了却还在被问，只会以为没保存。
   */
  resolveRuleSet: () => PermissionRuleSet
  /** run/会话级已批准模式：`${toolKey}\t${pattern}` → decision，pattern 支持通配 */
  sessionOverrides: Map<string, ApprovalDecision>
  store: LocalStore
  emit: (event: Omit<AgentEvent, 'runId'>) => void
  /** run 级中止信号：取消时挂起的审批/提问全部结算为拒绝 */
  signal: AbortSignal
  requestApproval: (input: Omit<ApprovalRequest, 'id'>, signal: AbortSignal) => Promise<ApprovalDecision>
  requestQuestion: (toolCallId: string, questions: QuestionItem[], signal: AbortSignal) => Promise<QuestionAnswer[]>
  /** MCP 工具按服务器注解声明的风险档位 */
  mcpToolRisk: ReadonlyMap<string, 'read' | 'write'>
  /** 命令执行的沙箱上下文；session 为 sandboxed 时命令进入受限系统环境 */
  sandbox?: { manager: SandboxManager | null; session: SandboxSession | null } | null
  subAgent?: SubAgentToolContext
  subAgentMetadata?: { parentToolCallId: string; subAgentId: string; subAgentRunId: string }
  customSubAgents?: import('./subagent/subagent-types').SubAgentConfig[]
  subAgentEnabled?: boolean
  /** 本项目探测到的验证命令；重复执行它们要豁免死循环守卫。 */
  verificationCommands?: readonly VerificationCommand[]
}

export interface ToolRuntimeContextRef {
  current: ToolRuntimeContext
}

function runtimeContext(source: ToolRuntimeContext | ToolRuntimeContextRef): ToolRuntimeContext {
  return 'current' in source ? source.current : source
}

/** 每轮追加到系统提示的工具清单说明，防止旧会话历史里「没有工具」的认知残留误导模型。 */
export function toolAvailabilityNote(context: Pick<ToolRuntimeContext, 'mode' | 'planMode' | 'shellToolName' | 'sandbox' | 'verificationCommands'>): string {
  if (context.mode !== 'agent') return ''
  // 计划模式下写工具会被系统直接拒绝，提前说明，避免模型反复重试同一个写调用。
  if (context.planMode) return `\n\n当前处于计划模式：只有 read、grep、find、ls、question、todowrite 与 git status / git diff / git log / git show 可用。edit、write、patch 以及其他 ${context.shellToolName} 命令会被系统直接拒绝，不要尝试。请阅读代码后输出分步实施计划（步骤、涉及文件、验证方式），等用户确认并退出计划模式再执行。`
  const sandboxed = context.sandbox?.session?.isolation === 'sandboxed'
  // 明确告知隔离状态，避免模型在被系统拒绝后反复重试同一条命令。
  const sandboxNote = sandboxed
    ? `\n${context.shellToolName} 命令运行在受限的系统沙箱账户下：只能写入当前工作区，工作区外与敏感目录会被操作系统拒绝，被拒绝时不要重试同一条命令。`
    : ''
  // 验证说明只在 agent 模式且非计划模式下追加：计划模式本来就不许执行命令。
  const verifyNote = verificationPrompt(context.verificationCommands ?? [])
  return `\n\n当前可用工具：read、grep、find、ls、edit、write、${context.shellToolName}、question（向用户提问）、todowrite（维护待办）、patch（通过补丁新建、修改或删除文件）。文件与命令操作受权限规则约束，必要时会请求用户批准。${sandboxNote}${verifyNote}`
}

/** 会话级放行按模式匹配而不是原串相等，否则换个参数就要重新批一次。 */
export function hasSessionOverride(overrides: ReadonlyMap<string, ApprovalDecision>, toolKey: string, subject: string): boolean {
  const prefix = `${toolKey}\t`
  for (const key of overrides.keys()) {
    if (key.startsWith(prefix) && matchPattern(key.slice(prefix.length), subject)) return true
  }
  return false
}

const PATH_TOOLS = new Set(['read', 'edit', 'write', 'grep', 'find', 'ls'])
const SHELL_TOOLS = new Set(['bash', 'powershell'])

/** 从工具入参抽取文件路径列表；patch 从 diff 头抽取全部目标路径。 */
function collectPathInputs(toolName: string, input: Record<string, unknown>): string[] {
  if (PATH_TOOLS.has(toolName)) {
    const value = input.path
    if (value === undefined || value === null || value === '') return []
    return [String(value)]
  }
  if (toolName === 'patch') {
    const patchText = String(input.patch ?? '')
    const paths: string[] = []
    for (const line of patchText.split('\n')) {
      if (line.startsWith('--- ') || line.startsWith('+++ ')) {
        const target = line.slice(4).trim().replace(/^[ab]\//, '')
        if (target && target !== '/dev/null') paths.push(target)
      }
    }
    return [...new Set(paths)]
  }
  return []
}

/** 重定向 / tee 的目标里能静态确认是字面路径的才要；变量、命令替换、通配符判不出实际文件。 */
function acceptShellTarget(raw: string): string | null {
  const value = raw.replace(/^["']|["']$/g, '').trim()
  if (!value) return null
  if (/[$`*?]/.test(value)) return null
  if (/^%[^%]+%$/.test(value)) return null
  const lower = value.toLowerCase()
  if (lower === '/dev/null' || lower === 'nul' || lower === 'con') return null
  return value
}

const SHELL_REDIRECT_RE = /(?:^|[\s;&|(])\d?>>?\s*("[^"]+"|'[^']+'|[^\s;&|)>]+)/g
const SHELL_TEE_RE = /(?:^|[\s;&|(])tee\s+((?:-{1,2}[\w-]+\s+)*)("[^"]+"|'[^']+'|[^\s;&|)>]+)/g

/**
 * 从 shell 命令里抽出显式写入目标：`> file`、`>> file`、`tee file`。
 * bash 写出的文件没有路径入参可认，只能从命令本身看；这里只收字面路径，
 * 判不准的（变量、管道产物、脚本内部写盘）宁可漏登记，也不能凭猜往产物面板里塞。
 */
export function collectShellWriteTargets(command: string): string[] {
  const targets: string[] = []
  for (const match of command.matchAll(SHELL_REDIRECT_RE)) {
    const target = acceptShellTarget(match[1])
    if (target) targets.push(target)
  }
  for (const match of command.matchAll(SHELL_TEE_RE)) {
    const target = acceptShellTarget(match[2])
    if (target) targets.push(target)
  }
  return [...new Set(targets)]
}

/** 会写盘的工具：这些调用前后要抓文件快照，本轮变更账本全靠它。 */
const WRITE_TOOLS = new Set(['write', 'edit', 'patch'])

/**
 * 本轮每个文件的基线快照：该文件第一次被写工具碰之前的样子。
 * 每次工具结束都拿「基线 vs 当前」重算，同一文件改多少次都只得出一份最终状态，
 * 天然满足「改 3 次仍算 1 个文件」。
 */
const runBaselines = new Map<string, FileSnapshot>()
/** 一轮最多为多少个文件保留基线；超出后该文件退化成按次比较，避免大批量改动把内存吃穿。 */
const MAX_BASELINES_PER_TURN = 200

/**
 * 基线键。用 JSON 数组序列化：路径与工作区里什么字符都可能出现，自己拼分隔符迟早撞上。
 * turnId 放最前，清理时按前缀扫得到；带上工作区，同一 turnId 跨项目也不会串。
 */
function baselineKey(turnId: string, cwd: string, path: string): string {
  return JSON.stringify([turnId, cwd, path])
}

/** 回合结束后清掉这一轮的基线，长会话不会一直攒着历史文件内容。 */
export function clearRunBaselines(turnId: string) {
  const prefix = `[${JSON.stringify(turnId)},`
  for (const key of runBaselines.keys()) {
    if (key.startsWith(prefix)) runBaselines.delete(key)
  }
}

/** 从工具入参解析出本次会碰到的写入目标（工作区内的相对路径 + 绝对路径）。 */
function writeTargets(toolName: string, input: Record<string, unknown>, cwd: string): Array<{ path: string; absolutePath: string }> {
  const raw = WRITE_TOOLS.has(toolName)
    ? collectPathInputs(toolName, input)
    : SHELL_TOOLS.has(toolName) && typeof input.command === 'string'
      ? collectShellWriteTargets(input.command)
      : []
  const targets: Array<{ path: string; absolutePath: string }> = []
  for (const item of raw) {
    try {
      const resolved = resolveToolPath(item, cwd)
      // 工作区外的写入不算项目变更，Bar 只对本项目负责
      if (resolved.external) continue
      const path = resolved.relativePath.replace(/\\/g, '/')
      if (path && !targets.some((target) => target.path === path)) targets.push({ path, absolutePath: resolved.absolutePath })
    } catch {
      // 路径解析不了就不追踪，宁可漏也不能记错
    }
  }
  return targets
}

/** 入参摘要：shell 取命令，文件类取路径，其余取 JSON 摘要。 */
export function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  if (SHELL_TOOLS.has(toolName) && typeof input.command === 'string') {
    const command = input.command.trim()
    return command.length > 200 ? `${command.slice(0, 200)}…` : command
  }
  if (PATH_TOOLS.has(toolName) && typeof input.path === 'string') return input.path
  const entries = Object.entries(input)
  if (!entries.length) return ''
  const json = JSON.stringify(entries.slice(0, 3).reduce<Record<string, unknown>>((acc, [key, value]) => {
    acc[key] = typeof value === 'string' && value.length > 120 ? `${value.slice(0, 120)}…` : value
    return acc
  }, {}))
  return json.length > 300 ? `${json.slice(0, 300)}…` : json
}

function countDiffLines(diff: string, marker: '+' | '-'): number {
  let count = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith(marker) && !line.startsWith(marker.repeat(3))) count += 1
  }
  return count
}

export interface ChangeStats {
  additions: number
  deletions: number
}

/**
 * 增删行数只有 edit / patch 能算准：edit 有逐行 diff，patch 自带每个文件的统计。
 * 其余工具（read/write/bash…）没有可比对的旧内容，返回 null 让界面别显示 +0 -0。
 */
export function changeStats(event: ToolResultEvent): ChangeStats | null {
  if (event.isError) return null
  if (event.toolName === 'edit') {
    if (!isEditToolResult(event) || !event.details?.diff) return null
    return { additions: countDiffLines(event.details.diff, '+'), deletions: countDiffLines(event.details.diff, '-') }
  }
  if (event.toolName === 'patch') {
    const files = (event.details as { filesChanged?: Array<{ additions: number; deletions: number }> } | undefined)?.filesChanged
    if (!files) return null
    return {
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0)
    }
  }
  return null
}

function resultDetail(errorText: string, stats: ChangeStats | null): string {
  if (errorText) return errorText.length > 300 ? `${errorText.slice(0, 300)}…` : errorText
  if (!stats || stats.additions + stats.deletions === 0) return '已完成'
  const parts = [stats.additions ? `+${stats.additions}` : '', stats.deletions ? `-${stats.deletions}` : ''].filter(Boolean)
  return `已完成 · ${parts.join(' ')}`
}

export function createToolRuntimeExtension(source: ToolRuntimeContext | ToolRuntimeContextRef): ExtensionFactory {
  return (pi) => {
    const initial = runtimeContext(source)
    let doomLoop = new DoomLoopGuard()
    let doomLoopRunId = initial.runId
    const startedAt = new Map<string, number>()
    // 本次调用声明要写的文件，onToolResult 据此复查磁盘
    const pendingTargets = new Map<string, Array<{ path: string; absolutePath: string }>>()
    const decisionByCall = new Map<string, ApprovalDecision | 'allow' | 'deny'>()
    const contextByCall = new Map<string, ToolRuntimeContext>()

    pi.registerTool(createQuestionTool({
      cwd: initial.cwd,
      signal: initial.signal,
      requestQuestion: (toolCallId, questions) => {
        const context = runtimeContext(source)
        return context.requestQuestion(toolCallId, questions, context.signal)
      }
    }))
    pi.registerTool(createTodoTool({
      cwd: initial.cwd,
      namespace: initial.namespace,
      conversationId: initial.conversationId,
      setTodos: (namespace, conversationId, items) => runtimeContext(source).store.setTodos(namespace, conversationId, items),
      listTodos: (namespace, conversationId) => runtimeContext(source).store.listTodos(namespace, conversationId),
      emit: (event) => runtimeContext(source).emit(event)
    }))
    pi.registerTool(createPatchTool())
    // 工具只在运行时创建时注册一次，之后整个会话复用：signal / 执行桥 / 自定义 Sub-agent 列表
    // 一律按轮从 ref 现取，否则第二轮起用的是首轮闭包（事件写错回合、停止按钮失效）。
    if (initial.subAgent) pi.registerTool(createSubAgentTool({
      resolveSignal: () => runtimeContext(source).signal,
      resolveCustomAgents: () => runtimeContext(source).customSubAgents ?? [],
      execute: (task, signal, parentToolCallId) => {
        const bridge = runtimeContext(source).subAgent
        if (!bridge) throw new Error('Sub-agent 未启用')
        return bridge.execute(task, signal, parentToolCallId)
      },
      emit: (event) => runtimeContext(source).emit(event)
    }))

    // shell 工具由这里注册而不是走 pi 内置：注册时注入自定义执行后端，
    // 沙箱开关只切换 operations 实现，杜绝绕过沙箱的执行路径。
    if (initial.mode === 'agent') {
      const operations = createShellOperations(() => {
        const context = runtimeContext(source)
        return {
          shellToolName: context.shellToolName,
          bashPath: context.bashPath,
          session: context.sandbox?.session ?? null,
          manager: context.sandbox?.manager ?? null
        }
      })
      pi.registerTool(initial.shellToolName === 'powershell'
        ? createPowerShellToolDefinition(initial.cwd, { operations, exposeSessionEnvironment: false })
        : createBashToolDefinition(initial.cwd, { operations, exposeSessionEnvironment: false }))
    }

    // 兜底：把当前工具清单追加进系统提示，旧会话历史里「没有工具」的说法不会误导模型
    if (initial.mode === 'agent') {
      pi.on('before_agent_start', async (event) => ({
        systemPrompt: `${event.systemPrompt}${toolAvailabilityNote(runtimeContext(source))}`
      }))
    }

    const onToolCall: ExtensionHandler<ToolCallEvent, ToolCallEventResult> = async (event) => {
      const context = runtimeContext(source)
      contextByCall.set(event.toolCallId, context)
      if (doomLoopRunId !== context.runId) {
        doomLoop = new DoomLoopGuard()
        doomLoopRunId = context.runId
      }
      const toolName = event.toolName
      const toolSource = toolName.startsWith('cli__') ? 'cli' as const : SHELL_TOOLS.has(toolName) ? 'command' as const : toolName === 'skill' ? 'skill' as const : toolName === 'agent' ? 'agent' as const : toolName.startsWith('mcp__') ? 'mcp' as const : 'builtin' as const
      const input = event.input as Record<string, unknown>
      startedAt.set(event.toolCallId, Date.now())

      let toolKey = logicalToolKey(toolName)
      let subject = ''
      let secret: SecretClassification = null
      // 触发密钥分类的那个路径。secret_file 规则要按它匹配：subject 取的是第一个路径，
      // 命中密钥的可能是后面某一个，用 subject 去查会漏判。
      let secretSubject = ''
      const paths = collectPathInputs(toolName, input)
      if (paths.length > 0) {
        let firstResolved: ResolvedToolPath | null = null
        let external = false
        for (const rawPath of paths) {
          const resolved = resolveToolPath(rawPath, context.cwd)
          if (!firstResolved) firstResolved = resolved
          if (resolved.external) external = true
          const classified = classifySecretPath(resolved.relativePath) ?? classifySecretPath(resolved.absolutePath)
          if (classified && !secretSubject) secretSubject = resolved.relativePath
          secret = mergeSecretClassification(secret, classified)
        }
        if (firstResolved) subject = firstResolved.relativePath
        if (external) toolKey = 'external_directory'
      } else if (SHELL_TOOLS.has(toolName) && typeof input.command === 'string') {
        toolKey = 'shell'
        subject = input.command
      }

      if (toolName.startsWith('mcp__')) {
        // MCP 工具不触碰本地文件，按服务器注解映射到 mcp_read / mcp_write 权限入口。
        const risk = context.mcpToolRisk.get(toolName) ?? 'write'
        toolKey = risk === 'read' ? 'mcp_read' : 'mcp_write'
        subject = summarizeInput(toolName, input)
      }

      // 「跑验证 → 改代码 → 重跑同一条验证」是正确的工作方式，但入参完全相同，
      // 不豁免的话第三次会被判成死循环并弹审批，把正常的验证循环打断。
      const verifying = SHELL_TOOLS.has(toolName)
        && typeof input.command === 'string'
        && isVerificationCommand(input.command, context.verificationCommands ?? [])
      const doom = verifying ? { hash: '', triggered: false } : doomLoop.check(toolName, input)
      const ruleSet = context.resolveRuleSet()
      const actions: Array<import('../../shared/permission-rules').PermissionAction> = [resolvePermission(toolKey, subject, ruleSet)]
      if (secret) actions.push(resolvePermission('secret_file', secretSubject || subject, ruleSet))
      // 私钥的 deny 是所有档位的硬底线，不经规则集：守卫按 basename/路径片段分类，比规则模式鲁棒。
      // 其余密钥文件（.env、.aws/credentials 等）由 secret_file 规则决定，full 档下不再逐次确认。
      let action: PermissionAction = actions.includes('deny') || secret === 'deny'
        ? 'deny'
        : actions.includes('ask')
          ? 'ask'
          : 'allow'
      // 会话内已批准的模式优先放行（包括对显式 deny 的覆盖）。
      if (hasSessionOverride(context.sessionOverrides, toolKey, subject)) {
        action = 'allow'
      } else if (doom.triggered && action === 'allow') {
        // 重复循环即使规则放行也要走审批（failing 命令会先被 allow 规则放行）
        action = 'ask'
      }
      // 计划模式最后落闸：写入类调用无条件拒绝，用户规则与会话级放行都不能绕过。
      const planDenied = context.planMode && planModeAction(toolKey, subject) === 'deny'
      if (planDenied) action = 'deny'

      let decision: ApprovalDecision | 'allow' | 'deny' = action === 'allow' ? 'allow' : 'deny'
      // 先落库：审批中 waiting_permission，拒绝 denied，其余 running
      try {
        context.store.recordToolCall(context.namespace, {
          id: event.toolCallId,
          conversationId: context.conversationId,
          turnId: context.turnId,
          runId: context.runId,
          toolName,
          source: toolSource,
          arguments: input,
          status: action === 'ask' ? 'waiting_permission' : action === 'deny' ? 'denied' : 'running',
          permissionResult: action === 'ask' ? 'ask' : action,
          startedAt: new Date().toISOString(),
          parentToolCallId: context.subAgentMetadata?.parentToolCallId,
          subAgentId: context.subAgentMetadata?.subAgentId,
          subAgentRunId: context.subAgentMetadata?.subAgentRunId
        })
      } catch (error) {
        // tool_calls 只有一条外键：(namespace, conversation_id) → conversations。
        // 命中它就说明会话行在运行途中没了（多半是被删除），光打堆栈看不出是哪个会话。
        const conversationGone = !context.store.getConversation(context.namespace, context.conversationId)
        console.error('[tool-runtime] recordToolCall 失败:', {
          conversationId: context.conversationId,
          turnId: context.turnId,
          runId: context.runId,
          toolName,
          conversationGone,
          reason: conversationGone ? '会话记录已不存在，工具调用无法归档' : undefined,
          error
        })
      }
      const patterns = alwaysAllowPatterns(toolKey, subject)
      if (action === 'ask') {
        try {
          const result = await context.requestApproval({
            kind: doom.triggered ? 'doom_loop' : 'permission',
            tool: toolName,
            subject,
            cwd: context.cwd,
            risk: toolKey === 'shell' || toolKey === 'edit' || toolKey === 'external_directory' || toolKey === 'mcp_write' || secret !== null || doom.triggered,
            scopePatterns: patterns,
            options: doom.triggered
              ? { message: 'Agent 连续 3 次重复同一操作，可能陷入了循环。' }
              : undefined
          }, context.signal)
          decision = result
          if (result === 'reject') {
            action = 'deny'
          } else {
            action = 'allow'
            try {
              context.store.updateToolCall(context.namespace, event.toolCallId, { status: 'running', permissionResult: result })
            } catch (error) {
              console.error('[tool-runtime] updateToolCall 失败:', error)
            }
            if (result === 'session' || result === 'always') {
              for (const pattern of patterns) context.sessionOverrides.set(`${toolKey}\t${pattern}`, result)
              if (doom.triggered) doomLoop.exemptHash(doom.hash)
            }
            if (result === 'always') {
              for (const pattern of patterns) {
                context.store.upsertPermissionRule(context.namespace, { toolKey, pattern, action: 'allow' })
              }
            }
          }
        } catch {
          // 审批通道被取消（run 中止 / 窗口关闭 / 超时）
          action = 'deny'
          decision = 'deny'
        }
      }
      decisionByCall.set(event.toolCallId, decision)
      const denied = action === 'deny'
      const permissionLabel = denied ? 'deny' : decision

      context.emit({
        type: 'tool_started',
        tool: toolName,
        toolCallId: event.toolCallId,
        input: summarizeInput(toolName, input),
        detail: `正在运行 ${toolName}`,
        status: 'running',
        permissionResult: permissionLabel
        ,source: toolSource
      })

      if (denied) {
        const reason = planDenied
          ? `计划模式禁止写入操作（${toolName}）。请先输出实施计划，由用户确认并退出计划模式后再执行。`
          : decision === 'deny'
            ? `权限规则禁止执行（${toolKey}）`
            : decision === 'reject'
              ? `用户拒绝了该操作：${toolName} ${subject || ''}`.trim()
              : `操作未获批准：${toolName}`
        const durationMs = Date.now() - (startedAt.get(event.toolCallId) ?? Date.now())
        try {
          context.store.updateToolCall(context.namespace, event.toolCallId, { status: 'denied', permissionResult: 'denied', finishedAt: new Date().toISOString(), durationMs, error: reason })
        } catch (error) {
          console.error('[tool-runtime] updateToolCall 失败:', error)
        }
        context.emit({
          type: 'tool_result',
          tool: toolName,
          toolCallId: event.toolCallId,
          input: summarizeInput(toolName, input),
          detail: reason,
          status: 'failed',
          permissionResult: 'denied',
          source: toolSource,
          durationMs
        })
        // terminate 提示模型当前批次结束后停止；计划模式要让它拿着拒绝理由继续把计划写完。
        return { block: true, reason, terminate: !planDenied }
      }

      // 批准之后、真正写盘之前抓基线：写完再抓就永远拿不到「改之前长什么样」，
      // create 与 update 分不开，write 工具也算不出增删行数。
      const targets = writeTargets(toolName, input, context.cwd)
      if (targets.length) {
        pendingTargets.set(event.toolCallId, targets)
        for (const target of targets) {
          const key = baselineKey(context.turnId, context.cwd, target.path)
          if (runBaselines.has(key)) continue
          if (runBaselines.size >= MAX_BASELINES_PER_TURN) break
          runBaselines.set(key, snapshotFile(target.absolutePath))
        }
      }
      return undefined
    }

    const onToolResult: ExtensionHandler<ToolResultEvent, { content?: (TextContent | ImageContent)[] }> = async (event) => {
      const context = contextByCall.get(event.toolCallId) ?? runtimeContext(source)
      contextByCall.delete(event.toolCallId)
      const started = startedAt.get(event.toolCallId) ?? Date.now()
      const durationMs = Date.now() - started
      startedAt.delete(event.toolCallId)
      const decision = decisionByCall.get(event.toolCallId)
      decisionByCall.delete(event.toolCallId)

      const text = (event.content ?? [])
        .filter((item): item is { type: 'text'; text: string } => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
      // 用户在 question 中明确提供的内容必须原样进入模型上下文，避免被输出防护改写。
      const guarded = event.toolName === 'question' ? { text, truncated: false } : guardToolText(text)
      const changed = guarded.text !== text

      const stats = changeStats(event)
      // edit 的结果正文只有一句「Successfully replaced …」，逐行 diff 在 details 里；
      // 不落库的话展开工具卡片就没有可排版的内容。
      const diff = event.toolName === 'edit' && isEditToolResult(event) ? event.details?.diff ?? null : null

      const errorText = event.isError ? (text.trim().split('\n')[0] || '执行失败') : ''
      try {
        context.store.updateToolCall(context.namespace, event.toolCallId, {
          status: event.isError ? 'failed' : 'success',
          result: {
            summary: truncateText(guarded.text, MAX_STORED_SUMMARY_BYTES),
            ...(stats ?? {}),
            ...(diff ? { diff: truncateText(guardToolText(diff).text, MAX_STORED_SUMMARY_BYTES) } : {})
          },
          error: errorText || null,
          permissionResult: decision ?? null,
          finishedAt: new Date().toISOString(),
          durationMs
        })
      } catch (error) {
        console.error('[tool-runtime] updateToolCall 失败:', error)
      }

      context.emit({
        type: 'tool_result',
        tool: event.toolName,
        toolCallId: event.toolCallId,
        input: summarizeInput(event.toolName, event.input),
        detail: resultDetail(errorText, stats),
        status: event.isError ? 'failed' : 'completed',
        durationMs,
        permissionResult: decision ?? 'allow'
        ,source: event.toolName.startsWith('cli__') ? 'cli' : SHELL_TOOLS.has(event.toolName) ? 'command' : event.toolName === 'skill' ? 'skill' : event.toolName === 'agent' ? 'agent' : event.toolName.startsWith('mcp__') ? 'mcp' : 'builtin'
      })

      // 写盘工具跑完复查磁盘：拿本轮基线与当前状态比，得出这个文件在本轮的最终操作与增删行数。
      // 不靠工具自报——write 根本不给行数，shell 更是什么都不说；也不靠文件监听，
      // 那样分不清是 Agent 改的还是用户 / IDE / 构建改的。
      const targets = pendingTargets.get(event.toolCallId) ?? []
      pendingTargets.delete(event.toolCallId)
      if (!event.isError) {
        for (const target of targets) {
          const key = baselineKey(context.turnId, context.cwd, target.path)
          const baseline = runBaselines.get(key) ?? missingSnapshot()
          const current = snapshotFile(target.absolutePath)
          const operation = classifyOperation(baseline, current)
          if (!operation) {
            // 新建后又删掉，或者压根没改动：本轮看等于什么都没发生
            try {
              context.store.removeFileChange(context.namespace, context.turnId, target.path)
            } catch (error) {
              console.error('[file-ledger] 摘除变更失败:', error)
            }
            continue
          }
          const snapshotDiff = diffSnapshots(baseline, current)
          // 二进制 / 超大文件比不出行数，回落到工具自报的统计（edit / patch 有）
          const fallback = snapshotDiff.additions + snapshotDiff.deletions === 0 && !snapshotDiff.text ? stats : null
          const additions = fallback?.additions ?? snapshotDiff.additions
          const deletions = fallback?.deletions ?? snapshotDiff.deletions
          try {
            const previous = context.store.getFileChange(context.namespace, context.turnId, target.path)
            const tools = previous?.tools.includes(event.toolName) ? previous.tools : [...(previous?.tools ?? []), event.toolName]
            context.store.upsertFileChange(context.namespace, {
              turnId: context.turnId,
              conversationId: context.conversationId,
              runId: context.runId,
              path: target.path,
              operation,
              additions,
              deletions,
              tools,
              beforeHash: baseline.exists ? baseline.hash : null,
              afterHash: current.exists ? current.hash : null,
              diff: snapshotDiff.text || null
            })
          } catch (error) {
            console.error('[file-ledger] 记录变更失败:', error)
          }
          // Artifact 登记与 Bar 刷新都挂在这个事件上
          context.emit({ type: 'file_changed', path: target.path, detail: event.toolName, additions, deletions })
        }
      }

      if (!changed && event.toolName !== 'question') return undefined
      const images = (event.content ?? []).filter((item) => item.type === 'image')
      return { content: [{ type: 'text', text: guarded.text }, ...images] }
    }

    pi.on('tool_call', onToolCall)
    pi.on('tool_result', onToolResult)
  }
}

export function modeSystemPrompt(mode: ToolRuntimeContext['mode']): string {
  return builtInModeSystemPrompts[mode]
}
