import { describe, expect, it, vi } from 'vitest'
import { LocalMcpManager, mcpToolName, probeMcpServer, type McpClientFacade, type McpServerRuntimeConfig } from './mcp-manager'

const config: McpServerRuntimeConfig = {
  id: 'docs',
  name: 'Docs Server',
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
  env: {},
  enabled: true,
  timeoutMs: 5000
}

describe('local MCP manager', () => {
  it('规范化服务器与工具名称', () => {
    expect(mcpToolName('Docs Server', 'search docs')).toBe('mcp__Docs_Server__search_docs')
  })

  it('发现工具、保留风险注解并转发调用', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'result' }] }))
    const close = vi.fn(async () => undefined)
    const client: McpClientFacade = {
      connect: vi.fn(async () => undefined),
      listTools: vi.fn(async () => ({ tools: [{ name: 'search', description: 'Search docs', inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, annotations: { readOnlyHint: true } }] })),
      callTool,
      close
    }
    const manager = new LocalMcpManager([config], () => client)

    const bindings = await manager.connect()
    const result = await bindings[0].execute({ query: 'pi' }, new AbortController().signal)
    await manager.close()

    expect(bindings[0]).toMatchObject({ name: 'mcp__Docs_Server__search', description: 'Search docs', risk: 'read' })
    expect(result.content).toEqual([{ type: 'text', text: 'result' }])
    expect(callTool).toHaveBeenCalledWith('search', { query: 'pi' }, expect.any(AbortSignal), 5000)
    expect(close).toHaveBeenCalledOnce()
  })

  it('单个服务器连接失败不会阻断其它服务器', async () => {
    const broken = { ...config, id: 'broken', name: 'Broken' }
    const healthy = { ...config, id: 'healthy', name: 'Healthy' }
    const manager = new LocalMcpManager([broken, healthy], (server) => ({
      connect: async () => { if (server.id === 'broken') throw new Error('offline') },
      listTools: async () => ({ tools: server.id === 'healthy' ? [{ name: 'ping', inputSchema: { type: 'object' } }] : [] }),
      callTool: async () => ({ content: [] }),
      close: async () => undefined
    }))

    const bindings = await manager.connect()

    expect(bindings.map((item) => item.name)).toEqual(['mcp__Healthy__ping'])
    expect(manager.diagnostics).toEqual([{ serverId: 'broken', error: 'offline' }])
  })
})

describe('probeMcpServer', () => {
  const base = {
    connect: async () => undefined,
    listTools: async () => ({ tools: [{ name: 'search', inputSchema: { type: 'object' } }] }),
    callTool: async () => ({ content: [] }),
    close: async () => undefined
  }

  it('抓取 tools 与 resources / prompts 计数后断开', async () => {
    const close = vi.fn(async () => undefined)
    const result = await probeMcpServer(config, () => ({
      ...base,
      close,
      listResources: async () => ({ resources: [{}, {}] }),
      listPrompts: async () => ({ prompts: [{}] })
    }))

    expect(result).toMatchObject({ ok: true, error: null, resourceCount: 2, promptCount: 1 })
    expect(result.tools.map((tool) => tool.name)).toEqual(['search'])
    expect(close).toHaveBeenCalledOnce()
  })

  it('Server 不支持 resources / prompts 时按 0 计，仍算连接成功', async () => {
    const result = await probeMcpServer(config, () => ({
      ...base,
      listResources: async () => { throw new Error('Method not found') },
      listPrompts: async () => { throw new Error('Method not found') }
    }))

    expect(result).toMatchObject({ ok: true, resourceCount: 0, promptCount: 0 })
  })

  it('连接失败返回错误消息且不抛出', async () => {
    const close = vi.fn(async () => undefined)
    const result = await probeMcpServer(config, () => ({ ...base, close, connect: async () => { throw new Error('offline') } }))

    expect(result).toMatchObject({ ok: false, error: 'offline', tools: [], resourceCount: 0, promptCount: 0 })
    expect(close).toHaveBeenCalledOnce()
  })
})
