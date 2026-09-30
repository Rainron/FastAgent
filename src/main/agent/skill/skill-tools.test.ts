import { describe, expect, it } from 'vitest'
import { availableToolNames } from './skill-tools'

const EMPTY = { shellToolName: null, mcpServers: [], cliTools: [], subAgentEnabled: false }

describe('availableToolNames', () => {
  it('内置工具恒可用', () => {
    const names = availableToolNames(EMPTY)
    expect(names).toContain('read')
    expect(names).toContain('todowrite')
  })

  it('壳工具按实际可用的那个给出，同时接受 shell 这个统称', () => {
    const names = availableToolNames({ ...EMPTY, shellToolName: 'powershell' })
    expect(names).toContain('powershell')
    expect(names).toContain('shell')
    expect(availableToolNames(EMPTY)).not.toContain('shell')
  })

  it('MCP 同时给 server 名与完整调用名', () => {
    const names = availableToolNames({ ...EMPTY, mcpServers: [{ id: 'github', tools: ['search_issues'] }] })
    expect(names).toEqual(expect.arrayContaining(['github', 'mcp__github', 'mcp__github__search_issues']))
  })

  it('CLI 工具给裸 id 与 cli__ 前缀两种写法', () => {
    const names = availableToolNames({ ...EMPTY, cliTools: ['rg'] })
    expect(names).toEqual(expect.arrayContaining(['rg', 'cli__rg']))
  })

  it('子 Agent 关闭时 agent 工具不可用', () => {
    expect(availableToolNames(EMPTY)).not.toContain('agent')
    expect(availableToolNames({ ...EMPTY, subAgentEnabled: true })).toContain('agent')
  })
})
