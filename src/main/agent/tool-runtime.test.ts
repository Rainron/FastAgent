import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolCallEvent, ToolResultEvent, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentEvent, ApprovalDecision, ApprovalRequest, QuestionAnswer, QuestionItem, TodoItem } from '../../shared/types'
import { presetRuleSet, type PermissionRuleSet } from '../../shared/permission-rules'
import { createApprovalBridge, reevaluatePendingApprovals } from '../approval-bridge'
import { builtinProfile } from '../../shared/permission-profiles'
import { buildEffectiveRules } from './permission/effective-rules'
import type { LocalStore } from '../local-store'
import { changeStats, collectShellWriteTargets, createToolRuntimeExtension, modeSystemPrompt, toolAvailabilityNote } from './tool-runtime'

const roots: string[] = []

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-trt-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop() as string
    try { rmSync(root, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})

function fakeStore(overrides: Partial<Record<string, unknown>> = {}): LocalStore {
  return {
    recordToolCall: () => undefined,
    getConversation: () => ({ id: 'c1' }),
    updateToolCall: () => undefined,
    listToolCalls: () => [],
    setTodos: (_ns, _conversation, items: TodoItem[]) => items,
    listTodos: () => [],
    upsertPermissionRule: vi.fn(),
    listPermissionRules: () => [],
    removePermissionRule: () => undefined,
    // 变更账本：写盘工具跑完会落一条本轮变更
    getFileChange: () => null,
    upsertFileChange: () => undefined,
    removeFileChange: () => undefined,
    ...overrides
  } as unknown as LocalStore
}

interface Harness {
  cwd: string
  tools: ToolDefinition[]
  started: AgentEvent[]
  results: AgentEvent[]
  changes: AgentEvent[]
  approvals: Array<Partial<ApprovalRequest>>
  upserted: Array<{ toolKey: string; pattern: string; action: string }>
  onToolCall: (event: ToolCallEvent) => Promise<unknown>
  onToolResult: (event: ToolResultEvent) => Promise<unknown>
  toolCalls: Array<{ id: string; status: string; permissionResult?: string }>
}

function createHarness(options: { ruleSet?: PermissionRuleSet; overrides?: Map<string, ApprovalDecision>; approve?: ApprovalDecision; failApproval?: boolean; mcpRisk?: ReadonlyMap<string, 'read' | 'write'>; shellToolName?: 'bash' | 'powershell'; planMode?: boolean; store?: LocalStore } = {}): Harness {
  const workspace = makeWorkspace()
  const harness = {
    cwd: workspace,
    tools: [] as ToolDefinition[],
    started: [] as AgentEvent[],
    results: [] as AgentEvent[],
    changes: [] as AgentEvent[],
    approvals: [] as Array<Partial<ApprovalRequest>>,
    upserted: [] as Array<{ toolKey: string; pattern: string; action: string }>,
    toolCalls: [] as Array<{ id: string; status: string; permissionResult?: string }>,
    onToolCall: async () => undefined,
    onToolResult: async () => undefined
  }
  const store = options.store ?? fakeStore()
  ;(store as unknown as { upsertPermissionRule: ReturnType<typeof vi.fn> }).upsertPermissionRule
    ?.mockImplementation?.((_ns: string, input: { toolKey: string; pattern: string; action: string }) => harness.upserted.push(input))
  let target = harness
  const pi = {
    on: (event: string, handler: unknown) => {
      if (event === 'tool_call') target.onToolCall = handler as typeof target.onToolCall
      if (event === 'tool_result') target.onToolResult = handler as typeof target.onToolResult
    },
    registerTool: (tool: ToolDefinition) => harness.tools.push(tool)
  }
  const extension = createToolRuntimeExtension({
    namespace: 'ns',
    conversationId: 'c1',
    turnId: 't1',
    runId: 'r1',
    cwd: workspace,
    mode: 'agent',
    planMode: options.planMode ?? false,
    shellToolName: options.shellToolName ?? 'bash',
    resolveRuleSet: () => options.ruleSet ?? presetRuleSet('ask'),
    sessionOverrides: options.overrides ?? new Map(),
    store,
    signal: new AbortController().signal,
    emit: (event) => {
      if (event.type === 'tool_started') harness.started.push(event as AgentEvent)
      else if (event.type === 'tool_result') harness.results.push(event as AgentEvent)
      else if (event.type === 'file_changed') harness.changes.push(event as AgentEvent)
    },
    requestApproval: async (input) => {
      harness.approvals.push(input)
      if (options.failApproval) throw new DOMException('cancelled', 'AbortError')
      return options.approve ?? 'once'
    },
    requestQuestion: async (_toolCallId, questions: QuestionItem[]): Promise<QuestionAnswer[]> => questions.map((item) => ({ id: item.id, answer: '默认答案' })),
    mcpToolRisk: options.mcpRisk ?? new Map()
  })
  ;(extension as (pi: unknown) => void)(pi)
  return harness
}

function toolCall(patch: Partial<ToolCallEvent> & { toolName: string; input: Record<string, unknown>; toolCallId: string }): ToolCallEvent {
  return { type: 'tool_call', ...patch } as unknown as ToolCallEvent
}

describe('tool runtime extension', () => {
  it('为两种模式提供不同的内置系统提示词', () => {
    expect(modeSystemPrompt('chat')).toContain('不修改、不创建、不删除任何文件')
    expect(modeSystemPrompt('agent')).toContain('任务执行型智能体')
    expect(modeSystemPrompt('chat')).not.toBe(modeSystemPrompt('agent'))
  })
  it('注册自定义工具与 shell 工具，共两个钩子', () => {
    const harness = createHarness()
    // shell 工具改由扩展注册（而非 pi 内置白名单），才能注入沙箱执行后端。
    expect(harness.tools.map((tool) => tool.name)).toEqual(['question', 'todowrite', 'patch', 'bash'])
    expect(harness.tools.every((tool) => typeof tool.execute === 'function')).toBe(true)
  })

  it('shell 偏好切到 powershell 时注册 powershell 工具', () => {
    const harness = createHarness({ shellToolName: 'powershell' })
    expect(harness.tools.map((tool) => tool.name)).toEqual(['question', 'todowrite', 'patch', 'powershell'])
  })

  it('agent 模式注入工具清单说明，chat 模式不注入', () => {
    const agent = toolAvailabilityNote({ mode: 'agent', planMode: false, shellToolName: 'bash' })
    expect(agent).toContain('当前可用工具')
    expect(agent).toContain('edit')
    expect(agent).toContain('bash')
    expect(agent).not.toContain('系统沙箱')
    expect(toolAvailabilityNote({ mode: 'chat', planMode: false, shellToolName: 'bash' })).toBe('')
  })

  it('沙箱会话存在时在工具说明里声明隔离状态', () => {
    const sandboxed = toolAvailabilityNote({
      mode: 'agent',
      planMode: false,
      shellToolName: 'bash',
      sandbox: { manager: null, session: { id: 's1', workspacePath: null, accountMode: 'online', policy: {} as never, isolation: 'sandboxed', createdAt: 1 } }
    })
    expect(sandboxed).toContain('受限的系统沙箱账户')
  })

  it('ask 档下改文件弹审批，once 放行且不写会话覆盖', async () => {
    const harness = createHarness({ approve: 'once' })
    const result = await harness.onToolCall(toolCall({ toolCallId: 'call-edit', toolName: 'edit', input: { path: 'src/a.ts', edits: [{ oldText: 'x', newText: 'y' }] } }))
    expect(result).toBeUndefined()
    expect(harness.approvals).toHaveLength(1)
    expect(harness.approvals[0].kind).toBe('permission')
    expect(harness.approvals[0].risk).toBe(true)
    expect(harness.started).toHaveLength(1)
    expect(harness.started[0].input).toBe('src/a.ts')
  })

  it('删除补丁仍按工作区内 edit 操作审批', async () => {
    const harness = createHarness({ approve: 'once' })
    const result = await harness.onToolCall(toolCall({
      toolCallId: 'call-delete',
      toolName: 'patch',
      input: { patch: '--- a/src/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old' }
    }))
    expect(result).toBeUndefined()
    expect(harness.approvals).toHaveLength(1)
    expect(harness.approvals[0]).toMatchObject({ tool: 'patch', subject: join('src', 'a.ts'), risk: true })
  })

  it('删除补丁的旧路径越界时按 external_directory 拒绝', async () => {
    const harness = createHarness()
    const result = await harness.onToolCall(toolCall({
      toolCallId: 'call-delete-outside',
      toolName: 'patch',
      input: { patch: '--- a/../outside.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old' }
    }))
    expect(result).toMatchObject({ block: true, terminate: true })
    expect(harness.approvals).toHaveLength(0)
  })

  it('session 写入会话覆盖，always 额外落库 permission_rules（按可执行名泛化）', async () => {
    const overrides = new Map<string, ApprovalDecision>()
    const harness = createHarness({ overrides, approve: 'always' })
    await harness.onToolCall(toolCall({ toolCallId: 'call-1', toolName: 'bash', input: { command: 'npm run build' } }))
    expect([...overrides.keys()]).toEqual(['shell\tnpm', 'shell\tnpm *'])
    expect(harness.upserted).toEqual([
      { toolKey: 'shell', pattern: 'npm', action: 'allow' },
      { toolKey: 'shell', pattern: 'npm *', action: 'allow' }
    ])
  })

  it('泛化后换参数不再重复弹审批', async () => {
    const overrides = new Map<string, ApprovalDecision>()
    const harness = createHarness({ overrides, approve: 'always' })
    await harness.onToolCall(toolCall({ toolCallId: 'call-mvn-1', toolName: 'bash', input: { command: 'mvn -v' } }))
    await harness.onToolCall(toolCall({ toolCallId: 'call-mvn-2', toolName: 'bash', input: { command: 'mvn clean install' } }))
    expect(harness.approvals).toHaveLength(1)
  })

  it('复合命令与全局禁止清单里的可执行名不泛化', async () => {
    const overrides = new Map<string, ApprovalDecision>()
    const harness = createHarness({ overrides, approve: 'always' })
    await harness.onToolCall(toolCall({ toolCallId: 'call-chain', toolName: 'bash', input: { command: 'mvn -v && echo ok' } }))
    await harness.onToolCall(toolCall({ toolCallId: 'call-git', toolName: 'bash', input: { command: 'git remote -v' } }))
    expect(harness.upserted).toEqual([
      { toolKey: 'shell', pattern: 'mvn -v && echo ok', action: 'allow' },
      { toolKey: 'shell', pattern: 'git remote -v', action: 'allow' }
    ])
  })

  it('显式 deny 直接阻断并给出原因，不弹审批', async () => {
    const harness = createHarness({ ruleSet: presetRuleSet('workspace') })
    const result = await harness.onToolCall(toolCall({ toolCallId: 'call-rm', toolName: 'bash', input: { command: 'rm -rf node_modules' } }))
    expect(result).toMatchObject({ block: true, terminate: true })
    expect(String((result as { reason: string }).reason)).toContain('权限规则禁止')
    expect(harness.approvals).toHaveLength(0)
    expect(harness.results).toHaveLength(1)
    expect(harness.results[0].permissionResult).toBe('denied')
  })

  it('用户拒绝时同样阻断', async () => {
    const harness = createHarness({ approve: 'reject' })
    const result = await harness.onToolCall(toolCall({ toolCallId: 'call-x', toolName: 'edit', input: { path: 'src/a.ts', edits: [] } }))
    expect(result).toMatchObject({ block: true })
    expect(String((result as { reason: string }).reason)).toContain('用户拒绝')
  })

  it('MCP 工具默认放行：读写注解都不再弹审批', async () => {
    const risk = new Map<string, 'read' | 'write'>([['mcp__Docs__search', 'read'], ['mcp__Docs__add', 'write']])
    const harness = createHarness({ approve: 'once', mcpRisk: risk })
    const read = await harness.onToolCall(toolCall({ toolCallId: 'call-mcp-read', toolName: 'mcp__Docs__search', input: { query: 'pi' } }))
    const write = await harness.onToolCall(toolCall({ toolCallId: 'call-mcp-write', toolName: 'mcp__Docs__add', input: { text: 'x' } }))

    expect(read).toBeUndefined()
    expect(write).toBeUndefined()
    expect(harness.approvals).toHaveLength(0)
    expect(harness.results).toHaveLength(0)
  })

  it('审批通道取消（run 中止）按阻断处理', async () => {
    const harness = createHarness({ failApproval: true })
    const result = await harness.onToolCall(toolCall({ toolCallId: 'call-x', toolName: 'edit', input: { path: 'src/a.ts', edits: [] } }))
    expect(result).toMatchObject({ block: true })
    expect(harness.results[0].permissionResult).toBe('denied')
  })

  it('工作区外路径走 external_directory（ask 档 deny，workspace 档 ask）', async () => {
    const ask = createHarness()
    const denied = await ask.onToolCall(toolCall({ toolCallId: 'call-out', toolName: 'read', input: { path: '../outside.txt' } }))
    expect(denied).toMatchObject({ block: true })
    expect(ask.approvals).toHaveLength(0)

    const workspace = createHarness({ ruleSet: presetRuleSet('workspace'), approve: 'once' })
    await workspace.onToolCall(toolCall({ toolCallId: 'call-out', toolName: 'read', input: { path: '../outside.txt' } }))
    expect(workspace.approvals).toHaveLength(1)
  })

  it('full 档密钥文件不再审批，但 id_rsa 仍直接 deny', async () => {
    const harness = createHarness({ ruleSet: presetRuleSet('full'), approve: 'once' })
    writeFileSync(join(harness.cwd, '.env'), 'SECRET=1')
    mkdirSync(join(harness.cwd, '.ssh'), { recursive: true })
    writeFileSync(join(harness.cwd, '.ssh', 'id_rsa'), 'x')
    await harness.onToolCall(toolCall({ toolCallId: 'c-env', toolName: 'read', input: { path: '.env' } }))
    expect(harness.approvals).toHaveLength(0)
    const denied = await harness.onToolCall(toolCall({ toolCallId: 'c-rsa', toolName: 'read', input: { path: '.ssh/id_rsa' } }))
    expect(denied).toMatchObject({ block: true })
  })

  it('workspace 档密钥文件仍审批，且按命中密钥的那个路径匹配规则', async () => {
    const harness = createHarness({ ruleSet: presetRuleSet('workspace'), approve: 'once' })
    writeFileSync(join(harness.cwd, '.env'), 'SECRET=1')
    // 补丁的第一个路径是普通文件，密钥在第二个：secret_file 规则要按后者匹配。
    await harness.onToolCall(toolCall({
      toolCallId: 'c-patch-env',
      toolName: 'patch',
      input: { patch: '--- a/src/a.ts\n+++ b/.env\n@@ -1 +1 @@\n-old\n+new' }
    }))
    expect(harness.approvals).toHaveLength(1)
  })

  it('tool_result 脱敏并回写事件与统计', async () => {
    const harness = createHarness()
    await harness.onToolCall(toolCall({ toolCallId: 'call-b', toolName: 'bash', input: { command: 'echo hi' } }))
    const result = await harness.onToolResult({
      type: 'tool_result',
      toolCallId: 'call-b',
      toolName: 'bash',
      input: { command: 'echo hi' },
      isError: false,
      content: [{ type: 'text', text: 'API_KEY=sk-secret\nok' }],
      details: undefined
    } as unknown as ToolResultEvent)
    expect(result).toMatchObject({ content: [{ type: 'text', text: 'API_KEY=******\nok' }] })
    expect(harness.results[0]).toMatchObject({ type: 'tool_result', durationMs: expect.any(Number), permissionResult: 'once' })
  })

  it('会话覆盖优先于显式 deny', async () => {
    const overrides = new Map<string, ApprovalDecision>([['shell\trm -rf node_modules', 'session']])
    const harness = createHarness({ ruleSet: presetRuleSet('ask'), overrides })
    const result = await harness.onToolCall(toolCall({ toolCallId: 'call-rm', toolName: 'bash', input: { command: 'rm -rf node_modules' } }))
    expect(result).toBeUndefined()
    expect(harness.approvals).toHaveLength(0)
  })

  it('计划模式硬拒绝写入：不弹审批，且不终止本批次', async () => {
    const harness = createHarness({ planMode: true, ruleSet: presetRuleSet('full') })
    const write = await harness.onToolCall(toolCall({ toolCallId: 'plan-write', toolName: 'write', input: { path: 'src/a.ts', content: 'x' } }))
    expect(write).toMatchObject({ block: true, terminate: false })
    expect((write as { reason: string }).reason).toContain('计划模式')
    const build = await harness.onToolCall(toolCall({ toolCallId: 'plan-bash', toolName: 'bash', input: { command: 'npm run build' } }))
    expect(build).toMatchObject({ block: true, terminate: false })
    expect(harness.approvals).toHaveLength(0)
  })

  it('计划模式下只读探查与 git status 仍放行', async () => {
    const harness = createHarness({ planMode: true, ruleSet: presetRuleSet('ask') })
    expect(await harness.onToolCall(toolCall({ toolCallId: 'plan-read', toolName: 'read', input: { path: 'src/a.ts' } }))).toBeUndefined()
    expect(await harness.onToolCall(toolCall({ toolCallId: 'plan-status', toolName: 'bash', input: { command: 'git status --short' } }))).toBeUndefined()
    expect(harness.approvals).toHaveLength(0)
  })

  it('计划模式不被会话级放行绕过', async () => {
    const overrides = new Map<string, ApprovalDecision>([['edit\tsrc/a.ts', 'session'], ['shell\tnpm *', 'always']])
    const harness = createHarness({ planMode: true, ruleSet: presetRuleSet('full'), overrides })
    expect(await harness.onToolCall(toolCall({ toolCallId: 'plan-edit', toolName: 'edit', input: { path: 'src/a.ts' } }))).toMatchObject({ block: true, terminate: false })
    expect(await harness.onToolCall(toolCall({ toolCallId: 'plan-npm', toolName: 'bash', input: { command: 'npm run build' } }))).toMatchObject({ block: true, terminate: false })
  })

  it('连续第 3 次重复即使规则放行也触发 doom_loop 审批', async () => {
    const harness = createHarness({ ruleSet: presetRuleSet('full'), approve: 'session' })
    await harness.onToolCall(toolCall({ toolCallId: 'c1', toolName: 'bash', input: { command: 'npm test' } }))
    await harness.onToolCall(toolCall({ toolCallId: 'c2', toolName: 'bash', input: { command: 'npm test' } }))
    const third = await harness.onToolCall(toolCall({ toolCallId: 'c3', toolName: 'bash', input: { command: 'npm test' } }))
    expect(third).toBeUndefined()
    // 前两次放行不弹审批；第三次以 doom_loop 种类弹出
    expect(harness.approvals).toHaveLength(1)
    expect(harness.approvals[0].kind).toBe('doom_loop')
    // session 决策后豁免：第四次不再弹
    await harness.onToolCall(toolCall({ toolCallId: 'c4', toolName: 'bash', input: { command: 'npm test' } }))
    expect(harness.approvals).toHaveLength(1)
  })

  it('扩展复用时读取当前 run 的动态上下文', async () => {
    const firstStore = fakeStore()
    const secondStore = fakeStore()
    const firstRecord = vi.spyOn(firstStore, 'recordToolCall')
    const secondRecord = vi.spyOn(secondStore, 'recordToolCall')
    const firstEvents: Array<Omit<AgentEvent, 'runId'>> = []
    const secondEvents: Array<Omit<AgentEvent, 'runId'>> = []
    const firstApproval = vi.fn(async () => 'once' as const)
    const secondApproval = vi.fn(async () => 'once' as const)
    const base = {
      namespace: 'ns', conversationId: 'c1', turnId: 't1', runId: 'r1', cwd: makeWorkspace(),
      mode: 'agent' as const, shellToolName: 'bash' as const, resolveRuleSet: () => presetRuleSet('ask'),
      sessionOverrides: new Map<string, ApprovalDecision>(), store: firstStore,
      signal: new AbortController().signal, emit: (event: Omit<AgentEvent, 'runId'>) => firstEvents.push(event),
      requestApproval: firstApproval,
      requestQuestion: async () => [], mcpToolRisk: new Map<string, 'read' | 'write'>()
    }
    const ref = { current: base }
    let onToolCall = async (_event: ToolCallEvent): Promise<unknown> => undefined
    let onToolResult = async (_event: ToolResultEvent): Promise<unknown> => undefined
    const extension = (createToolRuntimeExtension as unknown as (context: { current: typeof base }) => (pi: unknown) => void)(ref)
    extension({
      registerTool: () => undefined,
      on: (name: string, handler: unknown) => {
        if (name === 'tool_call') onToolCall = handler as typeof onToolCall
        if (name === 'tool_result') onToolResult = handler as typeof onToolResult
      }
    })

    ref.current = {
      ...base,
      turnId: 't2', runId: 'r2', store: secondStore,
      emit: (event) => secondEvents.push(event), requestApproval: secondApproval
    }
    await onToolCall(toolCall({ toolCallId: 'dynamic-call', toolName: 'edit', input: { path: 'src/a.ts', edits: [] } }))
    // 变更账本比对前后快照：工具说改了但磁盘没动就不算变更，这里要真写一次才有 file_changed
    writeFileSync(join(base.cwd, 'src', 'a.ts'), 'changed\n', 'utf8')
    await onToolResult({ type: 'tool_result', toolCallId: 'dynamic-call', toolName: 'edit', input: { path: 'src/a.ts' }, isError: false, content: [{ type: 'text', text: 'ok' }] } as unknown as ToolResultEvent)

    expect(firstRecord).not.toHaveBeenCalled()
    expect(firstApproval).not.toHaveBeenCalled()
    expect(firstEvents).toEqual([])
    expect(secondRecord).toHaveBeenCalledWith('ns', expect.objectContaining({ turnId: 't2', runId: 'r2' }))
    expect(secondApproval).toHaveBeenCalledTimes(1)
    expect(secondEvents.map((event) => event.type)).toEqual(['tool_started', 'tool_result', 'file_changed'])
  })

  it('question 工具结果保留用户原始答案并传入后续模型上下文', async () => {
    const harness = createHarness()
    await harness.onToolCall(toolCall({ toolCallId: 'question-call', toolName: 'question', input: { questions: [] } }))
    const answer = 'API_KEY=sk-user-entered'
    const result = await harness.onToolResult({
      type: 'tool_result',
      toolCallId: 'question-call',
      toolName: 'question',
      input: { questions: [] },
      isError: false,
      content: [{ type: 'text', text: answer }]
    } as unknown as ToolResultEvent)
    expect(result).toMatchObject({ content: [{ type: 'text', text: answer }] })
  })
})

describe('changeStats', () => {
  function resultEvent(patch: Record<string, unknown>): ToolResultEvent {
    return { type: 'tool_result', toolCallId: 'c', input: {}, content: [], isError: false, ...patch } as unknown as ToolResultEvent
  }

  it('edit 按展示 diff 的行首标记数增删行', () => {
    // pi 的展示型 diff 形如 `+ 12 code` / `- 12 code` / `  12 code`
    const diff = ['  1 keep', '- 2 old', '+ 2 new', '+ 3 more', '  4 tail'].join('\n')
    expect(changeStats(resultEvent({ toolName: 'edit', details: { diff } }))).toEqual({ additions: 2, deletions: 1 })
  })

  it('patch 汇总每个文件的统计', () => {
    const details = { filesChanged: [{ additions: 3, deletions: 1 }, { additions: 2, deletions: 0 }] }
    expect(changeStats(resultEvent({ toolName: 'patch', details }))).toEqual({ additions: 5, deletions: 1 })
  })

  it('算不出增删的工具返回 null，界面据此不显示 +0 -0', () => {
    expect(changeStats(resultEvent({ toolName: 'write', details: undefined }))).toBeNull()
    expect(changeStats(resultEvent({ toolName: 'read', details: undefined }))).toBeNull()
    expect(changeStats(resultEvent({ toolName: 'bash', details: undefined }))).toBeNull()
    // edit 没拿到 diff 时同样不猜
    expect(changeStats(resultEvent({ toolName: 'edit', details: undefined }))).toBeNull()
    expect(changeStats(resultEvent({ toolName: 'edit', details: { diff: '+ 1 x' }, isError: true }))).toBeNull()
  })
})

describe('本轮变更账本', () => {
  function ledgerStore() {
    const upserts: Array<Record<string, unknown>> = []
    const removed: string[] = []
    const store = fakeStore({
      upsertFileChange: (_ns: string, input: Record<string, unknown>) => { upserts.push(input) },
      removeFileChange: (_ns: string, _turnId: string, path: string) => { removed.push(path) }
    })
    return { store, upserts, removed }
  }

  it('新建文件记为 create，整份内容都算新增行', async () => {
    const ledger = ledgerStore()
    const harness = createHarness({ store: ledger.store })
    await harness.onToolCall(toolCall({ toolCallId: 'c1', toolName: 'write', input: { path: 'src/new.ts', content: '' } }))
    writeFileSync(join(harness.cwd, 'src', 'new.ts'), 'a\nb\nc', 'utf8')
    await harness.onToolResult({ type: 'tool_result', toolCallId: 'c1', toolName: 'write', input: { path: 'src/new.ts' }, isError: false, content: [] } as unknown as ToolResultEvent)
    expect(ledger.upserts).toHaveLength(1)
    expect(ledger.upserts[0]).toMatchObject({ path: 'src/new.ts', operation: 'create', additions: 3, deletions: 0, tools: ['write'] })
    expect(harness.changes.map((event) => event.path)).toEqual(['src/new.ts'])
  })

  it('同一文件改两次仍是一条记录，行数按本轮基线重算而不是累加', async () => {
    const ledger = ledgerStore()
    const harness = createHarness({ store: ledger.store })
    writeFileSync(join(harness.cwd, 'src', 'a.ts'), 'one\n', 'utf8')
    await harness.onToolCall(toolCall({ toolCallId: 'c1', toolName: 'edit', input: { path: 'src/a.ts', edits: [] } }))
    writeFileSync(join(harness.cwd, 'src', 'a.ts'), 'two\n', 'utf8')
    await harness.onToolResult({ type: 'tool_result', toolCallId: 'c1', toolName: 'edit', input: { path: 'src/a.ts' }, isError: false, content: [] } as unknown as ToolResultEvent)
    await harness.onToolCall(toolCall({ toolCallId: 'c2', toolName: 'edit', input: { path: 'src/a.ts', edits: [] } }))
    writeFileSync(join(harness.cwd, 'src', 'a.ts'), 'three\n', 'utf8')
    await harness.onToolResult({ type: 'tool_result', toolCallId: 'c2', toolName: 'edit', input: { path: 'src/a.ts' }, isError: false, content: [] } as unknown as ToolResultEvent)
    // 两次写入的都是同一条 (turnId, path) 记录，第二次仍以「本轮之前的 one」为基线
    expect(ledger.upserts).toHaveLength(2)
    expect(ledger.upserts.every((item) => item.path === 'src/a.ts' && item.operation === 'update')).toBe(true)
    expect(ledger.upserts[1]).toMatchObject({ additions: 1, deletions: 1 })
  })

  it('工具报成功但磁盘没变化时不记账，也不发 file_changed', async () => {
    const ledger = ledgerStore()
    const harness = createHarness({ store: ledger.store })
    writeFileSync(join(harness.cwd, 'src', 'a.ts'), 'same\n', 'utf8')
    await harness.onToolCall(toolCall({ toolCallId: 'c1', toolName: 'edit', input: { path: 'src/a.ts', edits: [] } }))
    await harness.onToolResult({ type: 'tool_result', toolCallId: 'c1', toolName: 'edit', input: { path: 'src/a.ts' }, isError: false, content: [] } as unknown as ToolResultEvent)
    expect(ledger.upserts).toHaveLength(0)
    expect(ledger.removed).toEqual(['src/a.ts'])
    expect(harness.changes).toHaveLength(0)
  })

  it('本轮新建又删掉等于没发生，记录被摘掉', async () => {
    const ledger = ledgerStore()
    const harness = createHarness({ store: ledger.store })
    await harness.onToolCall(toolCall({ toolCallId: 'c1', toolName: 'write', input: { path: 'src/tmp.ts', content: '' } }))
    writeFileSync(join(harness.cwd, 'src', 'tmp.ts'), 'x', 'utf8')
    await harness.onToolResult({ type: 'tool_result', toolCallId: 'c1', toolName: 'write', input: { path: 'src/tmp.ts' }, isError: false, content: [] } as unknown as ToolResultEvent)
    await harness.onToolCall(toolCall({ toolCallId: 'c2', toolName: 'patch', input: { patch: '--- a/src/tmp.ts\n+++ /dev/null\n' } }))
    rmSync(join(harness.cwd, 'src', 'tmp.ts'))
    await harness.onToolResult({ type: 'tool_result', toolCallId: 'c2', toolName: 'patch', input: { patch: '--- a/src/tmp.ts\n+++ /dev/null\n' }, isError: false, content: [] } as unknown as ToolResultEvent)
    expect(ledger.upserts).toHaveLength(1)
    expect(ledger.removed).toEqual(['src/tmp.ts'])
  })
})

describe('collectShellWriteTargets', () => {
  it('认重定向与 tee 的字面目标', () => {
    expect(collectShellWriteTargets('echo hi > notes.txt')).toEqual(['notes.txt'])
    expect(collectShellWriteTargets('npm test >> logs/test.log')).toEqual(['logs/test.log'])
    expect(collectShellWriteTargets('cat a | tee out.txt')).toEqual(['out.txt'])
    expect(collectShellWriteTargets('cat a | tee -a "docs/my notes.md"')).toEqual(['docs/my notes.md'])
  })

  it('同一命令里的多个目标去重后全部返回', () => {
    expect(collectShellWriteTargets('build > out.log 2>> err.log && echo done >> out.log')).toEqual(['out.log', 'err.log'])
  })

  it('判不出实际文件的目标一律不认', () => {
    // 文件描述符重定向不是写文件
    expect(collectShellWriteTargets('npm run build 2>&1')).toEqual([])
    // 变量、命令替换、通配符静态解析不出路径，宁可漏
    expect(collectShellWriteTargets('echo x > $OUT')).toEqual([])
    expect(collectShellWriteTargets('echo x > "$(date).log"')).toEqual([])
    expect(collectShellWriteTargets('echo x > %TEMP%')).toEqual([])
    expect(collectShellWriteTargets('echo x > out*.txt')).toEqual([])
    // 空设备不是产物
    expect(collectShellWriteTargets('noisy-cmd > /dev/null 2>&1')).toEqual([])
    expect(collectShellWriteTargets('noisy-cmd > NUL')).toEqual([])
    // 没有写入的命令
    expect(collectShellWriteTargets('ls -la src')).toEqual([])
  })
})

describe('落库失败不能中断运行', () => {
  it('会话被删导致外键失败时照常执行工具，并在日志里点名会话', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const store = fakeStore({
        recordToolCall: () => { throw new Error('FOREIGN KEY constraint failed') },
        // 会话行已经没了，正是外键失败的成因
        getConversation: () => null
      })
      const harness = createHarness({ store, ruleSet: presetRuleSet('full') })
      const result = await harness.onToolCall({
        toolCallId: 'call-1',
        toolName: 'read_file',
        input: { path: 'a.txt' }
      } as never)
      // 工具没有因为落库失败而被拒
      expect(result).not.toEqual({ decision: 'deny' })
      const logged = error.mock.calls.find((call) => String(call[0]).includes('recordToolCall 失败'))
      expect(logged).toBeDefined()
      expect(logged?.[1]).toMatchObject({ conversationId: 'c1', runId: 'r1', conversationGone: true })
    } finally {
      error.mockRestore()
    }
  })
})

describe('运行途中改权限档位立刻生效', () => {
  it('外部技能读取已挂起时，切为完全访问恢复同一次工具调用', async () => {
    let preset: 'workspace' | 'full' = 'workspace'
    const events: Array<Omit<AgentEvent, 'runId'>> = []
    const bridge = createApprovalBridge('pending-skill-run', (event) => events.push(event), 'workspace')
    const extension = createToolRuntimeExtension({
      namespace: 'ns', conversationId: 'c1', turnId: 't1', runId: 'pending-skill-run',
      cwd: makeWorkspace(), mode: 'agent', planMode: false, shellToolName: 'bash',
      resolveRuleSet: () => buildEffectiveRules(builtinProfile(preset), [{ toolKey: 'external_directory', pattern: '*', action: 'ask' }]),
      sessionOverrides: new Map(), store: fakeStore(), signal: new AbortController().signal,
      emit: () => undefined, requestApproval: bridge.requestApproval,
      requestQuestion: async () => [], mcpToolRisk: new Map()
    })
    let onToolCall: (event: ToolCallEvent) => Promise<unknown> = async () => undefined
    extension({
      on: (event: string, handler: unknown) => { if (event === 'tool_call') onToolCall = handler as typeof onToolCall },
      registerTool: () => undefined
    } as never)
    const pending = onToolCall(toolCall({ toolCallId: 'skill-read', toolName: 'read', input: { path: '../.fa/skills/planning-with-files/SKILL.md' } }))
    expect(events[0]).toMatchObject({ type: 'approval_required', approval: { kind: 'permission' } })
    preset = 'full'
    expect(reevaluatePendingApprovals('pending-skill-run')).toBe(1)
    expect(await pending).toBeUndefined()
    expect(events.at(-1)).toMatchObject({ type: 'approval_resolved' })
  })

  it('规则集每次工具调用现取，不是 run 开始时定死的', async () => {
    // 先按逐次确认跑，工具会走审批；中途换成完全访问后同一个调用直接放行。
    let preset: 'ask' | 'full' = 'ask'
    const harness = createHarness({ approve: 'once' })
    const extension = createToolRuntimeExtension({
      namespace: 'ns', conversationId: 'c1', turnId: 't1', runId: 'r1',
      cwd: harness.cwd, mode: 'agent', planMode: false, shellToolName: 'bash',
      resolveRuleSet: () => presetRuleSet(preset),
      sessionOverrides: new Map(),
      store: fakeStore(),
      signal: new AbortController().signal,
      emit: () => undefined,
      requestApproval: async () => { throw new Error('不该走到审批') },
      requestQuestion: async () => [],
      mcpToolRisk: new Map()
    })
    let onToolCall: (event: ToolCallEvent) => Promise<unknown> = async () => undefined
    extension({
      on: (event: string, handler: unknown) => { if (event === 'tool_call') onToolCall = handler as typeof onToolCall },
      registerTool: () => undefined
    } as never)

    // full 档：外部目录写入直接放行，不请求审批
    preset = 'full'
    const allowed = await onToolCall({
      toolCallId: 'call-1', toolName: 'write',
      input: { path: 'C:/Users/demo/AppData/Local/Temp/x.ps1', content: 'x' }
    } as never)
    expect(allowed).not.toEqual({ decision: 'deny' })
  })

  it('收紧同样立刻生效：改回受限档后不再自动放行', async () => {
    // 用 workspace 档：它的 external_directory 是 ask（逐次确认档直接是 deny，不会走到审批）
    let preset: 'workspace' | 'full' = 'full'
    let asked = 0
    const extension = createToolRuntimeExtension({
      namespace: 'ns', conversationId: 'c1', turnId: 't1', runId: 'r1',
      cwd: makeWorkspace(), mode: 'agent', planMode: false, shellToolName: 'bash',
      resolveRuleSet: () => presetRuleSet(preset),
      sessionOverrides: new Map(),
      store: fakeStore(),
      signal: new AbortController().signal,
      emit: () => undefined,
      requestApproval: async () => { asked += 1; return 'once' },
      requestQuestion: async () => [],
      mcpToolRisk: new Map()
    })
    let onToolCall: (event: ToolCallEvent) => Promise<unknown> = async () => undefined
    extension({
      on: (event: string, handler: unknown) => { if (event === 'tool_call') onToolCall = handler as typeof onToolCall },
      registerTool: () => undefined
    } as never)

    const external = { path: 'C:/Users/demo/AppData/Local/Temp/y.ps1', content: 'y' }
    await onToolCall({ toolCallId: 'a', toolName: 'write', input: external } as never)
    expect(asked).toBe(0)

    preset = 'workspace'
    await onToolCall({ toolCallId: 'b', toolName: 'write', input: external } as never)
    expect(asked).toBe(1)
  })
})
