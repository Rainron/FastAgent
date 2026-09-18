import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'

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
  listResources?(): Promise<{ resources: unknown[] }>
  listPrompts?(): Promise<{ prompts: unknown[] }>
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

  async listResources() {
    return await this.client.listResources() as { resources: unknown[] }
  }

  async listPrompts() {
    return await this.client.listPrompts() as { prompts: unknown[] }
  }

  async callTool(name: string, args: Record<string, unknown>, signal: AbortSignal, timeoutMs: number) {
    return this.client.callTool({ name, arguments: args }, CallToolResultSchema, { signal, timeout: timeoutMs, resetTimeoutOnProgress: true })
  }

  async close() {
    await this.client.close()
  }
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
    const resourceCount = await countOptional(client.listResources && (async () => (await client!.listResources!()).resources))
    const promptCount = await countOptional(client.listPrompts && (async () => (await client!.listPrompts!()).prompts))
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
