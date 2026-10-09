import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import * as piRuntime from './pi-runtime'
import { presetRuleSet } from '../shared/permission-rules'
import type { AgentEvent } from '../shared/types'
import type { LocalStore } from './local-store'

describe('model sampling parameters', () => {
  it('模型能力映射透传到 pi 定义', async () => {
    const thinking_level_map = { minimal: null, xhigh: 'xhigh', max: 'max' }
    const { model } = await piRuntime.createModelRuntime({ id: 1, provider: 'openai', protocol: 'openai', name: 'test', model_name: 'test', api_key: 'test', supports_thinking: true, thinking_level_map } as never)
    expect(model.thinkingLevelMap).toEqual(thinking_level_map)
  })
  it('未设置 temperature 时仍保留 extra_body', async () => {
    const { model } = await piRuntime.createModelRuntime({ id: 1, provider: 'openai', protocol: 'openai', name: 'test', model_name: 'test', api_key: 'test', extra_body: { enable_thinking: false } } as never)
    expect(model.samplingParams).toMatchObject({ enable_thinking: false })
  })
  it('model_kind=multimodal 时模型定义申明图片输入', async () => {
    const { model } = await piRuntime.createModelRuntime({ id: 1, provider: 'openai', protocol: 'openai', name: 'test', model_name: 'test', api_key: 'test', model_kind: 'multimodal' } as never)
    expect(model.input).toContain('image')
  })
})

describe('withDeclaredVision', () => {
  const base = { id: 'm', name: 'm', api: 'openai-completions', provider: 'p', baseUrl: '', reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1, maxTokens: 1 }

  it('用户标记多模态时补上 image 输入', () => {
    const model = piRuntime.withDeclaredVision({ ...base, input: ['text'] } as never, { model_kind: 'multimodal' })
    expect(model.input).toEqual(['text', 'image'])
  })

  it('厂商目录已支持图片时不重复追加', () => {
    const model = piRuntime.withDeclaredVision({ ...base, input: ['text', 'image'] } as never, { model_kind: 'multimodal' })
    expect(model.input).toEqual(['text', 'image'])
  })

  it('只做并集：model_kind=chat 不会把目录里的图片能力降级', () => {
    const model = piRuntime.withDeclaredVision({ ...base, input: ['text', 'image'] } as never, { model_kind: 'chat' })
    expect(model.input).toEqual(['text', 'image'])
  })

  it('不修改传入的模型定义', () => {
    const original = { ...base, input: ['text'] } as never
    piRuntime.withDeclaredVision(original, { model_kind: 'multimodal' })
    expect((original as { input: string[] }).input).toEqual(['text'])
  })
})

/** 桌面应用与 pi CLI 环境隔离（方案 A）：只加载内联 tool-runtime 扩展，不发现磁盘扩展/skills/prompts。 */

const cleanups: string[] = []

function track(path: string): string {
  cleanups.push(path)
  return path
}

afterEach(() => {
  while (cleanups.length) {
    const path = cleanups.pop() as string
    try { rmSync(path, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})

function makeToolRuntime(cwd: string) {
  return {
    namespace: 'ns', conversationId: 'c1', turnId: 't1', runId: 'r1',
    cwd, mode: 'agent' as const, planMode: false, shellToolName: 'bash' as const,
    resolveRuleSet: () => presetRuleSet('ask'), sessionOverrides: new Map(),
    store: {
      recordToolCall: () => undefined,
      updateToolCall: () => undefined,
      setTodos: (_ns: string, _conversation: string, items: Array<{ id: string; content: string; status: string }>) => items,
      listTodos: () => [],
      listPermissionRules: () => [],
      upsertPermissionRule: () => undefined,
      removePermissionRule: () => undefined
    } as unknown as LocalStore,
    emit: (_event: Omit<AgentEvent, 'runId'>) => undefined,
    signal: new AbortController().signal,
    requestApproval: async () => 'reject' as const,
    requestQuestion: async () => [],
    mcpToolRisk: new Map()
  }
}

describe('createRuntimeSettingsManager', () => {
  it('覆写在 reload 后依然生效，不被磁盘上的 compaction.enabled=false 抹掉', async () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'fastagent-settings-cwd-')))
    const agentDir = track(mkdtempSync(join(tmpdir(), 'fastagent-settings-agentdir-')))
    // 历史版本 setAutoCompactionEnabled(false) 落盘的脏数据
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ compaction: { enabled: false } }))

    const settingsManager = piRuntime.createRuntimeSettingsManager(cwd, agentDir, { enabled: true, reserveTokens: 19_200, keepRecentTokens: 67_840 })
    expect(settingsManager.getCompactionSettings()).toEqual({ enabled: true, reserveTokens: 19_200, keepRecentTokens: 67_840 })

    // DefaultResourceLoader.reload() 内部就会调它：覆写必须活过这一步。
    await settingsManager.reload()
    expect(settingsManager.getCompactionSettings()).toEqual({ enabled: true, reserveTokens: 19_200, keepRecentTokens: 67_840 })
  })

  it('策略映射出的压缩参数活过 createPiSessionRuntime 内部的 resourceLoader.reload()', async () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'fastagent-settings-cwd-')))
    const agentDir = track(mkdtempSync(join(tmpdir(), 'fastagent-settings-agentdir-')))
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ compaction: { enabled: false } }))
    const runtime = await piRuntime.createPiSessionRuntime({
      prompt: 'hi', mode: 'agent', modePrompt: '', planMode: false,
      credentials: { id: -1, provider: 'x', protocol: 'openai', name: 'm', model_name: 'm', api_key: 'k' } as never,
      thinkingLevel: 'off' as never,
      contextPolicy: { conversationId: 'c1', strategy: 'conservative', autoSummary: true, triggerRatio: null, keepRecentTurns: null, forceCompaction: false, inheritGlobal: true },
      permission: null, attachments: [], workspaceRoot: cwd, signal: new AbortController().signal,
      agentDir, namespace: 'ns', conversationId: 'c1', turnId: 't1', runId: 'r1',
      store: { listPermissionRules: () => [] } as unknown as LocalStore,
      shellToolName: 'bash', resolveRuleSet: () => presetRuleSet('ask'), sessionOverrides: new Map(),
      requestApproval: async () => 'reject' as const, requestQuestion: async () => [],
      onEvent: () => undefined
    })
    try {
      // 128k 窗口 + conservative：触发点 85%（reserve 19200），压缩后落到 68%（keep 78848 + 摘要预算 8192）。
      expect(runtime.settingsManager.getCompactionSettings()).toEqual({ enabled: true, reserveTokens: 19_200, keepRecentTokens: 32_000 })
    } finally {
      await runtime.dispose()
    }
  })

  it('后续覆写与既有覆写合并，reload 后一并保留', async () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'fastagent-settings-cwd-')))
    const agentDir = track(mkdtempSync(join(tmpdir(), 'fastagent-settings-agentdir-')))
    const settingsManager = piRuntime.createRuntimeSettingsManager(cwd, agentDir, { enabled: true })
    piRuntime.applyPersistentOverrides(settingsManager, { retry: { provider: { maxRetries: 7 } } })

    await settingsManager.reload()
    expect(settingsManager.getCompactionSettings().enabled).toBe(true)
    expect(settingsManager.getProviderRetrySettings().maxRetries).toBe(7)
  })
})

describe('compactSessionFile', () => {
  it('session 文件不存在时直接报错，不去建模型运行时', async () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'fastagent-compact-cwd-')))
    const agentDir = track(mkdtempSync(join(tmpdir(), 'fastagent-compact-agentdir-')))
    let created = false
    await expect(piRuntime.compactSessionFile({
      credentials: { id: -1, provider: 'x', protocol: 'openai', name: 'm', model_name: 'm', api_key: 'k' } as never,
      sessionFile: join(cwd, 'missing.jsonl'),
      sessionDir: cwd,
      agentDir,
      cwd,
      compaction: { enabled: true },
      createModelRuntime: async () => { created = true; throw new Error('不应该走到这里') }
    })).rejects.toThrow('会话运行时记录不存在')
    expect(created).toBe(false)
  })
})

describe('desktop resource loader isolation', () => {
  it('按当前模式提供内置系统提示，不发现磁盘扩展/skills/prompts', async () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'fastagent-loader-cwd-')))
    const agentDir = track(mkdtempSync(join(tmpdir(), 'fastagent-agentdir-')))
    // 模拟 pi CLI 的全局扩展/skills 存在——私有 agentDir 里若被写入也绝不加载
    mkdirSync(join(agentDir, 'extensions'), { recursive: true })
    writeFileSync(join(agentDir, 'extensions', 'plan-mode.ts'), 'export default function () {}')
    mkdirSync(join(agentDir, 'skills'), { recursive: true })
    mkdirSync(join(agentDir, 'skills', 'fake'), { recursive: true })
    writeFileSync(join(agentDir, 'skills', 'fake', 'SKILL.md'), '---\nname: fake\n---\ncontent')

    const settingsManager = SettingsManager.create(cwd, agentDir)
    const loader = piRuntime.createDesktopResourceLoader({ cwd, agentDir, settingsManager, toolRuntime: makeToolRuntime(cwd) })
    await loader.reload()

    const extensions = loader.getExtensions()
    expect(extensions.errors).toEqual([])
    // 只有内联扩展；磁盘扩展（plan-mode 之类）不被加载
    expect(extensions.extensions.map((extension) => extension.path)).toEqual(['<inline:fastagent-tool-runtime>'])

    expect(loader.getSkills().skills).toEqual([])
    expect(loader.getPrompts().prompts).toEqual([])
    expect(loader.getSystemPrompt()).toContain('任务执行型智能体')
    // Agent 指令由 FastAgent 显式读取和合并，Pi 自己不再自动发现。
    const agentFiles = loader.getAgentsFiles().agentsFiles
    expect(agentFiles.some((file) => file.path.startsWith(agentDir))).toBe(false)
  })

  it('对话模式只挂权限拦截扩展与 read，禁止写类工具', async () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'fastagent-loader-cwd-')))
    const agentDir = track(mkdtempSync(join(tmpdir(), 'fastagent-agentdir-')))
    const settingsManager = SettingsManager.create(cwd, agentDir)
    writeFileSync(join(cwd, 'AGENTS.md'), '# Chat 不应加载')
    const loader = piRuntime.createDesktopResourceLoader({ cwd, agentDir, settingsManager, mode: 'chat', toolRuntime: { ...makeToolRuntime(cwd), mode: 'chat' } } as never)
    await loader.reload()
    expect(loader.getSystemPrompt()).toContain('当前模式属于轻量对话模式')
    // chat 也需要 tool-runtime：read/MCP 的权限拦截、skill 加载都在扩展里。
    expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual(['<inline:fastagent-tool-runtime>'])
    expect(loader.getSkills().skills).toEqual([])
    expect(loader.getAgentsFiles().agentsFiles).toEqual([])
  })

  it('显式传入的 Agent 上下文优先于 Pi 的磁盘上下文发现', async () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'fastagent-loader-cwd-')))
    const agentDir = track(mkdtempSync(join(tmpdir(), 'fastagent-agentdir-')))
    writeFileSync(join(cwd, 'AGENTS.md'), '# Project guide')

    const settingsManager = SettingsManager.create(cwd, agentDir)
    const loader = piRuntime.createDesktopResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      agentContextPrompt: '## FastAgent 持久化目录说明\n\n显式目录上下文',
      toolRuntime: makeToolRuntime(cwd)
    })
    await loader.reload()

    expect(loader.getAgentsFiles().agentsFiles).toEqual([])
    expect(loader.getSystemPrompt()).toContain('显式目录上下文')
    expect(loader.getSystemPrompt()).not.toContain('# Project guide')
  })
})

describe('Pi 会话工具白名单', () => {
  const toolNamesForMode = (piRuntime as unknown as {
    toolNamesForMode(mode: 'chat' | 'agent', shellToolName: 'bash' | 'powershell'): string[]
  }).toolNamesForMode

  it('Agent 模式启用当前 shell 工具', () => {
    expect(toolNamesForMode('agent', 'bash')).toContain('bash')
    expect(toolNamesForMode('agent', 'powershell')).toContain('powershell')
  })

  it('Chat 模式给全套只读工具与 shell，不给写类工具', () => {
    expect(toolNamesForMode('chat', 'bash')).toEqual(['read', 'grep', 'find', 'ls', 'bash'])
    expect(toolNamesForMode('chat', 'powershell')).toEqual(['read', 'grep', 'find', 'ls', 'powershell'])
    for (const writeTool of ['edit', 'write', 'patch']) {
      expect(toolNamesForMode('chat', 'bash')).not.toContain(writeTool)
    }
  })
})

describe('resolveEnabledTools', () => {
  const resolveEnabledTools = (piRuntime as unknown as {
    resolveEnabledTools(mode: 'chat' | 'agent', shellToolName: 'bash' | 'powershell', options: { subAgentEnabled: boolean; mcpToolNames?: string[]; toolAllowlist?: string[] }): string[]
  }).resolveEnabledTools
  const toolNamesForMode = (piRuntime as unknown as {
    toolNamesForMode(mode: 'chat' | 'agent', shellToolName: 'bash' | 'powershell'): string[]
  }).toolNamesForMode

  it('未启用 Sub-agent 时剔除 subagent 工具', () => {
    expect(resolveEnabledTools('agent', 'bash', { subAgentEnabled: false })).not.toContain('subagent')
    expect(resolveEnabledTools('agent', 'bash', { subAgentEnabled: true })).toContain('subagent')
  })

  it('无白名单时与 toolNamesForMode 保持一致', () => {
    expect(resolveEnabledTools('agent', 'bash', { subAgentEnabled: true })).toEqual(toolNamesForMode('agent', 'bash'))
  })

  it('白名单收窄内置工具：Sub-agent 子运行拿不到 todowrite 与写类工具', () => {
    const tools = resolveEnabledTools('agent', 'bash', { subAgentEnabled: false, toolAllowlist: ['read', 'grep', 'find', 'ls'] })
    expect(tools).toEqual(['read', 'grep', 'find', 'ls'])
    expect(tools).not.toContain('todowrite')
    expect(tools).not.toContain('write')
    expect(tools).not.toContain('bash')
  })

  it('MCP 工具不参与白名单交集，始终并入', () => {
    const tools = resolveEnabledTools('agent', 'bash', { subAgentEnabled: false, mcpToolNames: ['mcp__srv__search'], toolAllowlist: ['read'] })
    expect(tools).toEqual(['read', 'mcp__srv__search'])
  })

})

describe('Agent 结局分类（长任务异常停止修复）', () => {
  const classify = (piRuntime as unknown as { classifyRunOutcome(last: unknown, limits?: { contextWindow?: number | null; maxTokens?: number | null }): { kind: string; text: string; reason: string } }).classifyRunOutcome

  it('空响应（无正文且无工具调用）判定为需重试', () => {
    expect(classify({ role: 'assistant', content: [], stopReason: 'stop' }).kind).toBe('retry-empty')
  })

  it('stopReason=error 判定为失败并带出模型错误信息', () => {
    const outcome = classify({ role: 'assistant', content: [{ type: 'text', text: 'partial' }], stopReason: 'error', errorMessage: 'Connection reset' })
    expect(outcome.kind).toBe('failed')
    expect(outcome.reason).toBe('Connection reset')
  })

  it('stopReason=error 无错误信息时给出通用原因', () => {
    const outcome = classify({ role: 'assistant', content: [], stopReason: 'error' })
    expect(outcome.kind).toBe('failed')
    expect(outcome.reason).toContain('模型响应异常')
  })

  it('输出达到模型上限时判定为单次输出截断', () => {
    const outcome = classify({ role: 'assistant', content: [{ type: 'text', text: '部分内容' }], stopReason: 'length', usage: { input: 100, output: 8192, cacheRead: 0, cacheWrite: 0, totalTokens: 8292 } }, { contextWindow: 128_000, maxTokens: 8192 })
    expect(outcome.kind).toBe('interrupted')
    expect(outcome.text).toBe('部分内容')
    expect(outcome.reason).toContain('单次输出')
  })

  it('上下文挤压导致输出额度不足时给出真实原因', () => {
    const outcome = classify({ role: 'assistant', content: [{ type: 'thinking', thinking: '…' }], stopReason: 'length', usage: { input: 134, output: 1, cacheRead: 123_904, cacheWrite: 0, totalTokens: 124_039 } }, { contextWindow: 128_000, maxTokens: 8192 })
    expect(outcome.kind).toBe('interrupted')
    expect(outcome.reason).toContain('上下文空间不足')
    // 调用方据此判断「压缩本该介入却没介入」，单次输出截断不能带这个标记。
    expect((outcome as { contextPressure?: boolean }).contextPressure).toBe(true)
    const truncated = classify({ role: 'assistant', content: [{ type: 'text', text: '部分内容' }], stopReason: 'length', usage: { input: 100, output: 8192, cacheRead: 0, cacheWrite: 0, totalTokens: 8292 } }, { contextWindow: 128_000, maxTokens: 8192 })
    expect((truncated as { contextPressure?: boolean }).contextPressure).toBeUndefined()
  })

  it('runtimeCompactionSettings：带策略按策略换算，不带策略退回布尔开关', () => {
    const credentials = { context_window: 128_000 } as never
    expect(piRuntime.runtimeCompactionSettings({ credentials, contextPolicy: { conversationId: 'c1', strategy: 'conservative', autoSummary: true, triggerRatio: null, keepRecentTurns: null, forceCompaction: false, inheritGlobal: true } }))
      .toEqual({ enabled: true, reserveTokens: 19_200, keepRecentTokens: 32_000 })
    expect(piRuntime.runtimeCompactionSettings({ credentials, autoCompaction: false })).toEqual({ enabled: false })
    expect(piRuntime.runtimeCompactionSettings({ credentials })).toEqual({ enabled: true })
  })

  it('仅对真正吃满单次输出预算的响应自动续写', () => {
    const shouldAutoContinueLength = (piRuntime as unknown as {
      shouldAutoContinueLength(last: unknown, limits: { contextWindow?: number | null; maxTokens?: number | null }, attempts: number): boolean
    }).shouldAutoContinueLength
    expect(typeof shouldAutoContinueLength).toBe('function')
    if (!shouldAutoContinueLength) return
    expect(shouldAutoContinueLength({ stopReason: 'length', content: [{ type: 'text', text: '部分内容' }], usage: { input: 100, output: 8192, cacheRead: 1_000, cacheWrite: 0 } }, { contextWindow: 128_000, maxTokens: 8192 }, 0)).toBe(true)
    expect(shouldAutoContinueLength({ stopReason: 'length', content: [{ type: 'thinking', thinking: '…' }], usage: { input: 134, output: 1, cacheRead: 123_904, cacheWrite: 0 } }, { contextWindow: 128_000, maxTokens: 8192 }, 0)).toBe(false)
    expect(shouldAutoContinueLength({ stopReason: 'length', content: [{ type: 'text', text: '部分内容' }], usage: { input: 100, output: 8192, cacheRead: 1_000, cacheWrite: 0 } }, { contextWindow: 128_000, maxTokens: 8192 }, 3)).toBe(false)
  })

  it('有正文的正常结束判定为完成', () => {
    const outcome = classify({ role: 'assistant', content: [{ type: 'text', text: '完成' }], stopReason: 'stop' })
    expect(outcome.kind).toBe('completed')
    expect(outcome.text).toBe('完成')
  })

  it('多个文本块用换行拼接，避免 Markdown 标题/列表粘连', () => {
    const outcome = classify({ role: 'assistant', content: [{ type: 'text', text: '### Phase 3.1 — DTO' }, { type: 'text', text: '### Phase 3.2 — AuthService' }], stopReason: 'stop' })
    expect(outcome.text).toBe('### Phase 3.1 — DTO\n### Phase 3.2 — AuthService')
  })

  it('有工具调用的空正文不算空响应，按完成结算', () => {
    const outcome = classify({ role: 'assistant', content: [{ type: 'toolCall', id: 't1', name: 'bash', arguments: {} }], stopReason: 'stop' })
    expect(outcome.kind).toBe('completed')
  })

  it('aborted 判定为取消', () => {
    expect(classify({ role: 'assistant', content: [], stopReason: 'aborted' }).kind).toBe('cancelled')
  })
})

describe('Pi 运行设置', () => {
  it('启用 Pi 会话内自动压缩，避免单个应用回合耗尽上下文', () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'fastagent-loader-cwd-')))
    const agentDir = track(mkdtempSync(join(tmpdir(), 'fastagent-agentdir-')))
    const { createRuntimeSettingsManager } = piRuntime
    const manager = createRuntimeSettingsManager(cwd, agentDir)
    expect(manager.getCompactionEnabled()).toBe(true)
    expect(createRuntimeSettingsManager(cwd, agentDir, { enabled: false }).getCompactionEnabled()).toBe(false)
  })

  it('按真实 Pi session 消息计算分类，并用 provider 总量校准', () => {
    const measureRuntimeContext = (piRuntime as unknown as {
      measureRuntimeContext(session: { systemPrompt: string; messages: unknown[]; getContextUsage(): { tokens: number | null; contextWindow: number } }, credentials: { id: number; provider: string; context_window?: number | null }): { estimatedTokens: number; messageTokens: number; toolTokens: number; systemTokens: number; summaryTokens: number; countingMethod: string }
    }).measureRuntimeContext
    expect(typeof measureRuntimeContext).toBe('function')
    const result = measureRuntimeContext({
      systemPrompt: '系统提示'.repeat(20),
      messages: [
        { role: 'user', content: [{ type: 'text', text: '处理项目' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: '分析' }, { type: 'toolCall', name: 'read', arguments: { path: 'a.ts' } }] },
        { role: 'toolResult', content: [{ type: 'text', text: '文件内容'.repeat(30) }] },
        { role: 'compactionSummary', summary: '历史摘要'.repeat(10) }
      ],
      getContextUsage: () => ({ tokens: 1000, contextWindow: 128_000 })
    }, { id: 1, provider: 'anthropic', context_window: 128_000 })
    expect(result.estimatedTokens).toBe(1000)
    expect(result.messageTokens).toBeGreaterThan(0)
    expect(result.toolTokens).toBeGreaterThan(0)
    expect(result.systemTokens).toBeGreaterThan(0)
    expect(result.summaryTokens).toBeGreaterThan(0)
    expect(result.messageTokens + result.toolTokens + result.systemTokens + result.summaryTokens).toBe(1000)
    expect(result.countingMethod).toBe('provider-usage')
  })

  it('文本附件使用跨文件总字符预算', async () => {
    const root = track(mkdtempSync(join(tmpdir(), 'fastagent-attachments-')))
    const attachments = ['a.txt', 'b.txt', 'c.txt'].map((name) => {
      const localPath = join(root, name)
      writeFileSync(localPath, 'x'.repeat(100_000))
      return { id: name, name, localPath, type: 'text/plain', size: 100_000 }
    })
    const loadAttachmentInput = (piRuntime as unknown as {
      loadAttachmentInput(attachments: Array<{ id: string; name: string; localPath: string; type: string; size: number }>): Promise<{ textContext: string; textCharacters: number }>
    }).loadAttachmentInput
    const result = await loadAttachmentInput(attachments)
    expect(result.textCharacters).toBe(200_000)
    expect(result.textContext).toContain('--- a.txt ---')
    expect(result.textContext).toContain('--- b.txt ---')
    expect(result.textContext).not.toContain('--- c.txt ---')
  })
})

describe('助手流事件映射（思考边界）', () => {
  const repair = (text: string) => text
  const types = (mapping: { events: Array<{ type: string }> }) => mapping.events.map((event) => event.type)

  it('首个正文增量先收尾思考再吐字', () => {
    const started = piRuntime.mapAssistantStreamEvent({ type: 'thinking_start' }, false, repair)
    expect(types(started)).toEqual(['thinking_started'])
    const thinking = piRuntime.mapAssistantStreamEvent({ type: 'thinking_delta', delta: '推理' }, started.thinkingActive, repair)
    expect(thinking.events).toEqual([{ type: 'thinking', text: '推理' }])
    const text = piRuntime.mapAssistantStreamEvent({ type: 'text_delta', delta: '回答' }, thinking.thinkingActive, repair)
    expect(text.events).toEqual([{ type: 'thinking_ended' }, { type: 'token', text: '回答' }])
    expect(text.thinkingActive).toBe(false)
  })

  it('思考已结束后的正文增量不重复发结束事件', () => {
    const ended = piRuntime.mapAssistantStreamEvent({ type: 'thinking_end' }, true, repair)
    expect(types(ended)).toEqual(['thinking_ended'])
    const text = piRuntime.mapAssistantStreamEvent({ type: 'text_delta', delta: 'a' }, ended.thinkingActive, repair)
    expect(text.events).toEqual([{ type: 'token', text: 'a' }])
  })

  it('run 开始预发思考、模型直接出正文时同样在首个 token 前收尾', () => {
    const text = piRuntime.mapAssistantStreamEvent({ type: 'text_delta', delta: 'a' }, true, repair)
    expect(text.events).toEqual([{ type: 'thinking_ended' }, { type: 'token', text: 'a' }])
    expect(text.thinkingActive).toBe(false)
  })

  it('未开启思考时 thinking_end 不产生事件', () => {
    expect(piRuntime.mapAssistantStreamEvent({ type: 'thinking_end' }, false, repair).events).toEqual([])
  })
})

describe('deliveredSteerMessages', () => {
  it('队列里消失的那条算已投递', () => {
    expect(piRuntime.deliveredSteerMessages(['A', 'B'], ['B'])).toEqual(['A'])
  })

  it('同一句话排两次时一次只判定投递一条', () => {
    expect(piRuntime.deliveredSteerMessages(['继续', '继续'], ['继续'])).toEqual(['继续'])
  })

  it('队列没变化时不产生投递', () => {
    expect(piRuntime.deliveredSteerMessages(['A'], ['A'])).toEqual([])
  })

  it('新入队不算投递', () => {
    expect(piRuntime.deliveredSteerMessages([], ['A'])).toEqual([])
  })
})
