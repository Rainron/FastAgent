import { describe, expect, it } from 'vitest'
import { parseMcpImport } from './mcp-import'

describe('mcp import parser', () => {
  it('解析 claude 风格的 mcpServers 对象', () => {
    const inputs = parseMcpImport(JSON.stringify({
      mcpServers: {
        'docs-server': { command: 'npx', args: ['-y', 'docs-mcp'], env: { API_KEY: '…' } }
      }
    }))
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({ id: 'docs-server', name: 'docs-server', transport: 'stdio', command: 'npx', args: ['-y', 'docs-mcp'], enabled: true })
    expect(inputs[0].env).toEqual({ API_KEY: '…' })
  })

  it('解析 servers 分组与 HTTP 形式', () => {
    const inputs = parseMcpImport(JSON.stringify({
      servers: {
        remote: { url: 'https://mcp.example/mcp', headers: { Authorization: 'Bearer x' }, timeout_seconds: 30 }
      }
    }))
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({ id: 'remote', transport: 'streamable_http', url: 'https://mcp.example/mcp', timeoutMs: 30000 })
    expect(inputs[0].headers).toEqual({ Authorization: 'Bearer x' })
  })

  it('解析数组与单对象格式，并给名称生成合法 id', () => {
    const byArray = parseMcpImport(JSON.stringify([{ name: 'My Server', command: 'node', args: 'server.js', enabled: false }]))
    expect(byArray[0]).toMatchObject({ id: 'my-server', name: 'My Server', args: ['server.js'], enabled: false })

    const single = parseMcpImport(JSON.stringify({ name: 'Solo', command: 'python', args: ['main.py'] }))
    expect(single[0]).toMatchObject({ id: 'solo', transport: 'stdio' })
  })

  it('非法 JSON 或空配置抛错', () => {
    expect(() => parseMcpImport('not json')).toThrow('JSON')
    expect(() => parseMcpImport(JSON.stringify({ other: 1 }))).toThrow('没有可识别')
  })
})