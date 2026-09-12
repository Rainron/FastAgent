import { describe, expect, it } from 'vitest'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { createMcpBridgeExtension, jsonSchemaToTypeBox } from './mcp-bridge'
import type { McpToolBinding } from './mcp-manager'

describe('MCP bridge', () => {
  it('把 JSON Schema 转成 TypeBox 结构，必填字段进入 required 列表', () => {
    const schema = jsonSchemaToTypeBox({ type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] })
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['query']
    })
  })

  it('为每个绑定注册同名工具并把调用转发到 binding', async () => {
    const tools: ToolDefinition[] = []
    let lastArgs: Record<string, unknown> | null = null
    const binding: McpToolBinding = {
      name: 'mcp__Docs__search',
      description: 'Search docs',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      risk: 'read',
      async execute(args) { lastArgs = args; return { content: [{ type: 'text', text: 'ok' }], details: {} } }
    }
    const pi: ExtensionAPI = {
      registerTool: (tool) => { tools.push(tool as ToolDefinition) }
    } as unknown as ExtensionAPI

    createMcpBridgeExtension([binding])(pi)
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('mcp__Docs__search')
    await (tools[0].execute as unknown as (id: string, params: Record<string, unknown>, signal: AbortSignal) => Promise<{ content: unknown }>)('call-1', { query: 'pi' }, new AbortController().signal)
    expect(lastArgs).toEqual({ query: 'pi' })
  })
})