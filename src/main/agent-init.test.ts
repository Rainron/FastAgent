import { describe, expect, it } from 'vitest'
import { buildAgentInitTemplate, detectExistingAgentInitFile } from './agent-init'

describe('detectExistingAgentInitFile', () => {
  it('AGENTS.md 与 CLAUDE.md 都算已存在，AGENTS.md 优先', () => {
    expect(detectExistingAgentInitFile(['src/main.ts', 'AGENTS.md'])).toBe('AGENTS.md')
    expect(detectExistingAgentInitFile(['CLAUDE.md'])).toBe('CLAUDE.md')
    expect(detectExistingAgentInitFile(['AGENTS.md', 'CLAUDE.md'])).toBe('AGENTS.md')
  })

  it('没有记忆文件返回 null', () => {
    expect(detectExistingAgentInitFile(['README.md', 'src'])).toBeNull()
    expect(detectExistingAgentInitFile([])).toBeNull()
  })
})

describe('buildAgentInitTemplate', () => {
  it('模板包含项目名与主要章节', () => {
    const template = buildAgentInitTemplate('demo')
    expect(template.startsWith('# demo')).toBe(true)
    for (const section of ['## 项目说明', '## 常用命令', '## 编码风格', '## 测试与验证', '## 提交规范']) {
      expect(template).toContain(section)
    }
  })
})