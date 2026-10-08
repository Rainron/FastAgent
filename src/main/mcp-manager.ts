import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpPromptDescriptor, McpPromptResult, McpResourceContent, McpResourceDescriptor, McpResourceTemplateDescriptor } from '../shared/types'

export interface McpServerRuntimeConfig {
  id: string
  name: string
  transport: 'stdio' | 'streamable_http'
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  timeoutMs: number
}

export interface McpToolDescriptor {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

export interface McpClientFacade {
  connect(): Promise<void>
  listTools(): Promise<{ tools: McpToolDescriptor[] }>
  callTool(name: string, args: Record<string, unknown>, signal: AbortSignal, timeoutMs: number): Promise<unknown>
  close(): Promise<void>
  /** 可选能力：Server 未实现时 SDK 会抛 MethodNotFound，探测时按 0 计。 */
  listResources?(signal?: AbortSignal, timeoutMs?: number): Promise<{ resources: Array<McpResourceDescriptor | Record<string, unknown>> }>
  listResourceTemplates?(signal?: AbortSignal, timeoutMs?: number): Promise<{ resourceTemplates: Array<McpResourceTemplateDescriptor | Record<string, unknown>> }>
  readResource?(uri: string, signal: AbortSignal, timeoutMs: number): Promise<{ contents: McpResourceContent[] }>
  listPrompts?(signal?: AbortSignal, timeoutMs?: number): Promise<{ prompts: Array<McpPromptDescriptor | Record<string, unknown>> }>
  getPrompt?(name: string, args: Record<string, string>, signal: AbortSignal, timeoutMs: number): Promise<McpPromptResult>
}

export interface McpToolBinding {
  name: string
  /** 工具所属的 MCP Server id，用于记「这一轮用到了哪个能力」 */
  serverId: string
  description: string
  inputSchema: Record<string, unknown>
  risk: 'read' | 'write'
  execute(args: Record<string, unknown>, signal: AbortSignal): Promise<{ content: Array<{ type: 'text'; text: string }>; details: unknown }>
}

export function mcpToolName(server: string, tool: string) {
  const normalize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `mcp__${normalize(server)}__${normalize(tool)}`
}

function normalizeResult(value: unknown) {
  const result = value as { content?: Array<{ type?: string; text?: string }>; structuredContent?: unknown }
  let content = (result.content ?? []).map((item) => item.type === 'text' && typeof item.text === 'string'
    ? { type: 'text' as const, text: item.text }
    : { type: 'text' as const, text: JSON.stringify(item) })
  if (!content.length) content.push({ type: 'text', text: result.structuredContent === undefined ? 'MCP 工具执行完成' : JSON.stringify(result.structuredContent) })
  return { content, details: value ?? {} }
}

class SdkMcpClient implements McpClientFacade {
  private readonly client: Client
  private readonly transport: StdioClientTransport | StreamableHTTPClientTransport

  constructor(config: McpServerRuntimeConfig) {
    this.client = new Client({ name: 'fastagent-desktop', version: '1.0.0' })
    if (config.transport === 'stdio') {
      if (!config.command) throw new Error('stdio MCP 缺少 command')
      this.transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        env: { ...getDefaultEnvironment(), ...(config.env ?? {}) }
      })
    } else {
      if (!config.url) throw new Error('Streamable HTTP MCP 缺少 URL')
      this.transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } })
    }
  }

  async connect() {
    await this.client.connect(this.transport)
  }

  async listTools() {
    return await this.client.listTools() as { tools: McpToolDescriptor[] }
  }

  async listResources(signal?: AbortSignal, timeoutMs?: number) {
    return await this.client.listResources(undefined, { signal, timeout: timeoutMs }) as { resources: Array<McpResourceDescriptor | Record<string, unknown>> }
  }

  async listResourceTemplates(signal?: AbortSignal, timeoutMs?: number) {
    return await this.client.listResourceTemplates(undefined, { signal, timeout: timeoutMs }) as { resourceTemplates: Array<McpResourceTemplateDescriptor | Record<string, unknown>> }
  }

  async readResource(uri: string, signal: AbortSignal, timeoutMs: number) {
    return await this.client.readResource({ uri }, { signal, timeout: timeoutMs }) as { contents: McpResourceContent[] }
  }

  async listPrompts(signal?: AbortSignal, timeoutMs?: number) {
    return await this.client.listPrompts(undefined, { signal, timeout: timeoutMs }) as { prompts: Array<McpPromptDescriptor | Record<string, unknown>> }
  }

  async getPrompt(name: string, args: Record<string, string>, signal: AbortSignal, timeoutMs: number) {
    return await this.client.getPrompt({ name, arguments: args }, { signal, timeout: timeoutMs }) as McpPromptResult
  }

  async callTool(name: string, args: Record<string, unknown>, signal: AbortSignal, timeoutMs: number) {
    return this.client.callTool({ name, arguments: args }, CallToolResultSchema, { signal, timeout: timeoutMs, resetTimeoutOnProgress: true })
  }

  async close() {
    await this.client.close()
  }
}

async function withMcpTimeout<T>(timeoutMs: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await task(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

export async function withConnectedMcpServer<T>(config: McpServerRuntimeConfig, task: (client: McpClientFacade) => Promise<T>, factory: (config: McpServerRuntimeConfig) => McpClientFacade = (item) => new SdkMcpClient(item)): Promise<T> {
  const client = factory(config)
  try {
    await client.connect()
    return await task(client)
  } finally {
    await client.close().catch(() => undefined)
  }
}

export async function listMcpServerResources(config: McpServerRuntimeConfig, factory?: (config: McpServerRuntimeConfig) => McpClientFacade) {
  return withConnectedMcpServer(config, async (client) => ({
    resources: client.listResources ? (await withMcpTimeout(config.timeoutMs, (signal) => client.listResources!(signal, config.timeoutMs))).resources.filter((item): item is McpResourceDescriptor => typeof item.uri === 'string' && typeof item.name === 'string') : [],
    templates: client.listResourceTemplates ? (await withMcpTimeout(config.timeoutMs, (signal) => client.listResourceTemplates!(signal, config.timeoutMs))).resourceTemplates.filter((item): item is McpResourceTemplateDescriptor => typeof item.uriTemplate === 'string' && typeof item.name === 'string') : []
  }), factory)
}

export async function readMcpServerResource(config: McpServerRuntimeConfig, uri: string, factory?: (config: McpServerRuntimeConfig) => McpClientFacade) {
  return withConnectedMcpServer(config, async (client) => {
    if (!client.readResource) throw new Error('MCP Server 不支持读取 Resources')
    return withMcpTimeout(config.timeoutMs, (signal) => client.readResource!(uri, signal, config.timeoutMs))
  }, factory)
}

export async function listMcpServerPrompts(config: McpServerRuntimeConfig, factory?: (config: McpServerRuntimeConfig) => McpClientFacade) {
  return withConnectedMcpServer(config, async (client) => ({
    prompts: client.listPrompts
      ? (await withMcpTimeout(config.timeoutMs, (signal) => client.listPrompts!(signal, config.timeoutMs))).prompts.filter((item): item is McpPromptDescriptor => typeof item.name === 'string')
      : []
  }), factory)
}

export async function getMcpServerPrompt(config: McpServerRuntimeConfig, name: string, args: Record<string, string>, factory?: (config: McpServerRuntimeConfig) => McpClientFacade) {
  return withConnectedMcpServer(config, async (client) => {
    if (!client.getPrompt) throw new Error('MCP Server 不支持 Prompts')
    return withMcpTimeout(config.timeoutMs, (signal) => client.getPrompt!(name, args, signal, config.timeoutMs))
  }, factory)
}

export interface McpProbeResult {
  ok: boolean
  error: string | null
  tools: McpToolDescriptor[]
  resourceCount: number
  promptCount: number
}

async function countOptional(load: (() => Promise<{ length: number }>) | undefined) {
  if (!load) return 0
  try {
    return (await load()).length
  } catch {
    // Server 不支持 resources / prompts 时按 0 计，不影响连接判定。
    return 0
  }
}

/** 单次建连探测：抓 tools 与 resources/prompts 计数后立即断开，供连接测试与详情页使用。 */
export async function probeMcpServer(
  config: McpServerRuntimeConfig,
  factory: (config: McpServerRuntimeConfig) => McpClientFacade = (item) => new SdkMcpClient(item)
): Promise<McpProbeResult> {
  let client: McpClientFacade | null = null
  try {
    client = factory(config)
    await client.connect()
    const listed = await client.listTools()
    const resourceCount = await countOptional(client.listResources && (async () => (await client!.listResources!(undefined, config.timeoutMs)).resources))
    const promptCount = await countOptional(client.listPrompts && (async () => (await client!.listPrompts!(undefined, config.timeoutMs)).prompts))
    return { ok: true, error: null, tools: listed.tools, resourceCount, promptCount }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), tools: [], resourceCount: 0, promptCount: 0 }
  } finally {
    await client?.close().catch(() => undefined)
  }
}

export class LocalMcpManager {
  readonly diagnostics: Array<{ serverId: string; error: string }> = []
  private readonly clients: McpClientFacade[] = []

  constructor(private readonly configs: McpServerRuntimeConfig[], private readonly factory: (config: McpServerRuntimeConfig) => McpClientFacade = (config) => new SdkMcpClient(config)) {}

  async connect(): Promise<McpToolBinding[]> {
    const bindings: McpToolBinding[] = []
    for (const config of this.configs.filter((item) => item.enabled)) {
      const client = this.factory(config)
      try {
        await client.connect()
        this.clients.push(client)
        const listed = await client.listTools()
        for (const tool of listed.tools) {
          bindings.push({
            name: mcpToolName(config.name, tool.name),
            serverId: config.id,
            description: tool.description || `${config.name} 提供的 ${tool.name}`,
            inputSchema: tool.inputSchema,
            risk: tool.annotations?.readOnlyHint && !tool.annotations?.destructiveHint ? 'read' : 'write',
            execute: async (args, signal) => normalizeResult(await client.callTool(tool.name, args, signal, config.timeoutMs))
          })
        }
      } catch (error) {
        this.diagnostics.push({ serverId: config.id, error: error instanceof Error ? error.message : String(error) })
        try { await client.close() } catch { /* 连接失败后的清理不覆盖原始诊断 */ }
      }
    }
    return bindings
  }

  async close() {
    const clients = this.clients.splice(0)
    await Promise.allSettled(clients.map((client) => client.close()))
  }
}
