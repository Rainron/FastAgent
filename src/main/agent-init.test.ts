import { describe, expect, it } from 'vitest'
import { AGENT_INIT_FILE_NAME, buildAgentInitPrompt, renderProjectSurvey } from './agent-init'
import type { ProjectSurvey } from './agent/project-survey'

function survey(overrides: Partial<ProjectSurvey> = {}): ProjectSurvey {
  return {
    name: 'demo',
    entries: ['src/', 'src/index.ts', 'package.json'],
    entriesTruncated: false,
    configFiles: ['package.json'],
    stack: ['Node.js / npm 包', 'TypeScript'],
    commands: [{ label: 'test', command: 'npm run test', source: 'package.json scripts.test → vitest run' }],
    style: ['缩进以 2 空格为主（占比 90%）'],
    existingAgentFile: null,
    ...overrides
  }
}

describe('renderProjectSurvey', () => {
  it('五类勘察结果都进提示词，空结果也留下小节', () => {
    const text = renderProjectSurvey(survey({ style: [] }))
    for (const heading of ['目录结构', '关键配置文件', '初步识别的技术栈', '从配置提取的命令', '代码风格采样']) {
      expect(text).toContain(`## ${heading}`)
    }
    expect(text).toContain('- src/index.ts')
    expect(text).toContain('npm run test')
    // 命令来源要一起给：模型据此判断这条命令是真的还是推断出来的
    expect(text).toContain('package.json scripts.test → vitest run')
    expect(text).toContain('（未探测到）')
  })

  it('条目超过上限时截断并标注剩余数量', () => {
    const many = Array.from({ length: 200 }, (_, index) => `src/file-${index}.ts`)
    const text = renderProjectSurvey(survey({ entries: many, entriesTruncated: true }))
    expect(text).toContain('另有 80 项未列出')
    expect(text).toContain('条目数超过扫描上限')
  })
})

describe('buildAgentInitPrompt', () => {
  it('新建场景：要求写入 AGENTS.md 并覆盖五个步骤', () => {
    const prompt = buildAgentInitPrompt(survey())
    expect(prompt).toContain(AGENT_INIT_FILE_NAME)
    expect(prompt).toContain('还没有 agent 指令文件')
    for (const step of ['摸清结构', '读配置', '定技术栈', '收集命令', '采样风格']) {
      expect(prompt).toContain(step)
    }
    for (const heading of ['## 项目概述', '## 技术栈', '## 目录结构', '## 常用命令', '## 编码规范', '## 修改与验证']) {
      expect(prompt).toContain(heading)
    }
    // 扫描结果只是起点：不强调核实就会被原样抄进文档
    expect(prompt).toContain('只写核实过的事实')
  })

  it('已有指令文件时改成补全订正，并指向那个文件', () => {
    const prompt = buildAgentInitPrompt(survey({ existingAgentFile: 'CLAUDE.md' }))
    expect(prompt).toContain('已有 CLAUDE.md')
    expect(prompt).toContain('不要整篇重写')
    expect(prompt).toContain('写入 CLAUDE.md')
  })
})
