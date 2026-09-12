import { describe, expect, it } from 'vitest'
import { parseRegistryResponse, parseRegistryServer, type RegistryServerEntry } from './server-json'

// 取自 registry.modelcontextprotocol.io 的真实返回形状。
const remoteEntry: RegistryServerEntry = {
  server: {
    name: 'ai.smithery/Hint-Services-obsidian-github-mcp',
    description: 'Connect AI assistants to your GitHub-hosted Obsidian vault',
    version: '0.4.0',
    repository: { url: 'https://github.com/Hint-Services/obsidian-github-mcp', source: 'github' },
    remotes: [{
      type: 'streamable-http',
      url: 'https://server.smithery.ai/@Hint-Services/obsidian-github-mcp/mcp',
      headers: [{ name: 'Authorization', description: 'Bearer token', isRequired: true, isSecret: true, value: 'Bearer {smithery_api_key}' }]
    }]
  },
  _meta: { 'io.modelcontextprotocol.registry/official': { publishedAt: '2025-09-14T15:20:36.371442Z' } }
}

const npmEntry: RegistryServerEntry = {
  server: {
    name: 'ai.adtest/adtest-mcp',
    title: 'AdTest',
    description: '广告素材分析',
    version: '1.1.0',
    packages: [{
      registryType: 'npm',
      identifier: 'adtest-mcp',
      version: '1.1.0',
      transport: { type: 'stdio' },
      environmentVariables: [
        { name: 'ADTEST_API_KEY', description: '开发者 API Key', isRequired: true, isSecret: true },
        { name: 'ADTEST_API_BASE', description: '可选 base URL' }
      ]
    }]
  }
}

describe('parseRegistryServer', () => {
  it('远端 server 映射成 streamable_http，请求头变成配置项', () => {
    const parsed = parseRegistryServer(remoteEntry)
    expect(parsed?.payloads).toEqual([{
      kind: 'mcp', name: 'Hint-Services-obsidian-github-mcp', transport: 'streamable_http',
      url: 'https://server.smithery.ai/@Hint-Services/obsidian-github-mcp/mcp', timeoutMs: 10_000
    }])
    expect(parsed?.detail.configFields).toEqual([
      { key: 'Authorization', label: 'Authorization', target: 'header', required: true, secret: true, description: 'Bearer token' }
    ])
  })

  it('远端 server 不标记为会跑本地代码', () => {
    expect(parseRegistryServer(remoteEntry)?.detail.permissions).toMatchObject({ runsLocalCode: false, fileAccess: false, networkAccess: true })
  })

  it('registry 的 name 直接当 ref，作者取命名空间', () => {
    const parsed = parseRegistryServer(remoteEntry)
    expect(parsed?.detail.ref).toBe('ai.smithery/Hint-Services-obsidian-github-mcp')
    expect(parsed?.detail.author).toBe('ai.smithery')
    expect(parsed?.detail.publishedAt).toBe('2025-09-14T15:20:36.371442Z')
  })

  it('npm 包映射成 npx -y', () => {
    const parsed = parseRegistryServer(npmEntry)
    expect(parsed?.payloads[0]).toMatchObject({ transport: 'stdio', command: 'npx', args: ['-y', 'adtest-mcp@1.1.0'] })
  })

  it('stdio server 如实标出会跑本地代码并列出命令与环境变量', () => {
    expect(parseRegistryServer(npmEntry)?.detail.permissions).toMatchObject({
      runsLocalCode: true,
      fileAccess: true,
      commands: ['npx -y adtest-mcp@1.1.0'],
      envKeys: ['ADTEST_API_KEY', 'ADTEST_API_BASE']
    })
  })

  it('必填与可选环境变量都成为配置项，密钥标记保留', () => {
    expect(parseRegistryServer(npmEntry)?.detail.configFields).toEqual([
      { key: 'ADTEST_API_KEY', label: 'ADTEST_API_KEY', target: 'env', required: true, secret: true, description: '开发者 API Key' },
      { key: 'ADTEST_API_BASE', label: 'ADTEST_API_BASE', target: 'env', required: false, secret: false, description: '可选 base URL' }
    ])
  })

  it('pypi 包用 uvx 与 == 版本语法', () => {
    const parsed = parseRegistryServer({
      server: { name: 'x/y', version: '1.0.0', packages: [{ registryType: 'pypi', identifier: 'mcp-thing', version: '2.3.0' }] }
    })
    expect(parsed?.payloads[0]).toMatchObject({ command: 'uvx', args: ['mcp-thing==2.3.0'] })
  })

  it('runtimeHint 优先于 registryType 推断', () => {
    const parsed = parseRegistryServer({
      server: { name: 'x/y', packages: [{ registryType: 'npm', identifier: 'thing', runtimeHint: 'bunx' }] }
    })
    expect(parsed?.payloads[0]).toMatchObject({ command: 'bunx', args: ['thing'] })
  })

  it('同时有 remotes 与 packages 时优先远端', () => {
    const parsed = parseRegistryServer({
      server: {
        name: 'x/y',
        remotes: [{ type: 'streamable-http', url: 'https://mcp.example/x' }],
        packages: [{ registryType: 'npm', identifier: 'thing' }]
      }
    })
    expect(parsed?.payloads[0]).toMatchObject({ transport: 'streamable_http', url: 'https://mcp.example/x' })
  })

  it('已有固定值且非密钥的请求头不问用户', () => {
    const parsed = parseRegistryServer({
      server: { name: 'x/y', remotes: [{ type: 'streamable-http', url: 'https://mcp.example/x', headers: [{ name: 'Accept', value: 'application/json' }] }] }
    })
    expect(parsed?.detail.configFields).toEqual([])
  })

  it('既无可用 remotes 也无可识别包时返回 null', () => {
    expect(parseRegistryServer({ server: { name: 'x/y', packages: [{ registryType: 'brew', identifier: 'z' }] } })).toBeNull()
    expect(parseRegistryServer({ server: { name: 'x/y' } })).toBeNull()
  })

  it('缺 name 的记录返回 null', () => {
    expect(parseRegistryServer({ server: { description: '没有名字' } })).toBeNull()
  })
})

describe('parseRegistryResponse', () => {
  it('跳过装不了的记录，其余照常返回', () => {
    const parsed = parseRegistryResponse({ servers: [remoteEntry, { server: { name: 'bad/one' } }, npmEntry] })
    expect(parsed.map((item) => item.detail.displayName)).toEqual(['Hint-Services-obsidian-github-mcp', 'AdTest'])
  })

  it('返回体形状不对时给空数组而不是抛错', () => {
    expect(parseRegistryResponse({})).toEqual([])
    expect(parseRegistryResponse(null)).toEqual([])
  })
})
