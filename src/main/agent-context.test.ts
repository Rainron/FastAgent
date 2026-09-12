import { describe, expect, it } from 'vitest'
import { buildFaDirectoryContext, readAgentContextFiles, resolveAgentContextPaths, type AgentContextFile, mergeAgentContextFiles } from './agent-context'

 describe('Agent 指令文件模型', () => {
  it('按固定顺序解析全局与项目文件路径', () => {
    expect(resolveAgentContextPaths('C:\\Users\\demo', 'D:\\project')).toEqual([
      { source: 'global', name: 'CLAUDE.md', path: 'C:\\Users\\demo\\.fa\\CLAUDE.md' },
      { source: 'global', name: 'AGENTS.md', path: 'C:\\Users\\demo\\.fa\\AGENTS.md' },
      { source: 'project', name: 'CLAUDE.md', path: 'D:\\project\\CLAUDE.md' },
      { source: 'project', name: 'AGENTS.md', path: 'D:\\project\\AGENTS.md' }
    ])
  })

  it('按来源顺序合并内容并保留来源标记', () => {
    const files: AgentContextFile[] = [
      { source: 'global', name: 'CLAUDE.md', path: '/home/demo/.fa/CLAUDE.md', content: 'global claude' },
      { source: 'project', name: 'AGENTS.md', path: '/work/AGENTS.md', content: 'project agents' }
    ]
    expect(mergeAgentContextFiles(files)).toBe(
      '## 全局 Agent 指令：CLAUDE.md\n\nglobal claude\n\n## 项目 Agent 指令：AGENTS.md\n\nproject agents'
    )
  })

  it('读取全局和项目文件，去除 BOM 并限制上下文预算', () => {
    const result = readAgentContextFiles({
      home: '/home/demo',
      projectRoot: '/work',
      exists: () => true,
      read: (path) => path.includes('/work/') ? '\uFEFFproject' : 'global',
      maxFileCharacters: 6,
      maxTotalCharacters: 20
    })
    expect(result.errors).toEqual([])
    expect(result.files.map((file) => file.content)).toEqual(['global', 'global', 'global', 'gl'])
    expect(result.files.map((file) => Boolean(file.truncated))).toEqual([false, false, false, true])
  })

  it('没有可读文件时返回空字符串', () => {
    expect(mergeAgentContextFiles([])).toBe('')
  })

  it('合并额外的 FastAgent 目录上下文', () => {
    const context = buildFaDirectoryContext({
      dataRoot: '/home/demo/.fa',
      dataDir: '/home/demo/.fa/data',
      databasePath: '/home/demo/.fa/data/fastagent.db',
      sessionsDir: '/home/demo/.fa/sessions',
      agentDir: '/home/demo/.fa/agent',
      skillsDir: '/home/demo/.fa/skills',
      mcpDir: '/home/demo/.fa/mcp',
      pluginsDir: '/home/demo/.fa/plugins',
      attachmentsDir: '/home/demo/.fa/attachments',
      backupsDir: '/home/demo/.fa/backups',
      exportsDir: '/home/demo/.fa/exports',
      platformUserDataDir: '/home/demo/.config/FastAgent',
      locatorPath: '/home/demo/.config/FastAgent/data-location.json'
    })
    expect(context).toContain('## FastAgent 持久化目录说明')
    expect(context).toContain('/home/demo/.fa/data/fastagent.db')
    expect(context).toContain('/home/demo/.fa/plugins')
    expect(context).toContain('不代表 Agent 获得了访问授权')
    expect(context).toContain('不要通过 Shell 绕过工作区、权限策略或沙箱限制')
    expect(mergeAgentContextFiles([], context)).toBe(context)
    expect(mergeAgentContextFiles([], '  ')).toBe('')
  })
})
