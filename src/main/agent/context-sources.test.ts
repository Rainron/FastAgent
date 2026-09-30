import { describe, expect, it } from 'vitest'
import type { Ability, KbEntry } from '../../shared/types'
import type { AgentContextFile } from '../agent-context'
import { buildTurnContextSources, kbContextSources, ruleContextSources, skillContextSources } from './context-sources'

function kbEntry(patch: Partial<KbEntry> = {}): KbEntry {
  return { id: 'kb-1', projectId: 'p1', title: '部署约定', content: '发布前必须跑 npm test', createdAt: 1, updatedAt: 1, ...patch }
}

function ability(patch: Partial<Ability> = {}): Ability {
  return { id: 'code-review', name: 'code-review', displayName: '代码审查', type: 'skill', source: 'created', enabled: true, status: 'ready', ...patch }
}

describe('kbContextSources', () => {
  it('把命中的知识条目转成来源并压平摘要', () => {
    const [source] = kbContextSources([kbEntry({ content: '发布前\n\n必须  跑 npm test' })])
    expect(source).toMatchObject({ kind: 'kb', refId: 'kb-1', title: '部署约定', locator: null, detail: '发布前 必须 跑 npm test' })
  })

  it('超长正文按上限截断', () => {
    const [source] = kbContextSources([kbEntry({ content: 'a'.repeat(300) })])
    expect(source.detail).toHaveLength(121)
    expect(source.detail?.endsWith('…')).toBe(true)
  })

  it('来自文件的条目在摘要前标出原文位置', () => {
    const [source] = kbContextSources([kbEntry({ sourcePath: 'docs/guide.md', locator: 'L4-9', content: '先跑测试' })])
    expect(source.detail).toBe('docs/guide.md L4-9 · 先跑测试')
  })
})

describe('skillContextSources', () => {
  it('只收启用的 Skill，忽略 MCP 与 CLI', () => {
    const sources = skillContextSources([
      ability(),
      ability({ id: 'disabled-skill', enabled: false }),
      ability({ id: 'server', type: 'mcp' })
    ])
    expect(sources.map((source) => source.refId)).toEqual(['code-review'])
  })

  it('带版本时在说明里标出，且说明只声称描述被注入', () => {
    const [source] = skillContextSources([ability({ version: '1.2.0', localPath: 'K:/skills/code-review' })])
    expect(source.detail).toBe('v1.2.0 · 描述已注入，正文按需读取')
    expect(source.locator).toBe('K:/skills/code-review')
  })
})

describe('ruleContextSources', () => {
  it('区分项目与全局，截断时如实标注', () => {
    const files: AgentContextFile[] = [
      { source: 'project', name: 'AGENTS.md', path: 'K:/repo/AGENTS.md', content: 'x' },
      { source: 'global', name: 'CLAUDE.md', path: 'C:/Users/a/.fa/CLAUDE.md', content: 'y', truncated: true }
    ]
    expect(ruleContextSources(files)).toEqual([
      { kind: 'rule', refId: 'K:/repo/AGENTS.md', title: '项目 AGENTS.md', locator: 'K:/repo/AGENTS.md', detail: '整份注入' },
      { kind: 'rule', refId: 'C:/Users/a/.fa/CLAUDE.md', title: '全局 CLAUDE.md', locator: 'C:/Users/a/.fa/CLAUDE.md', detail: '整份注入（已按长度上限截断）' }
    ])
  })
})

describe('buildTurnContextSources', () => {
  it('缺省入参时返回空数组，不报错', () => {
    expect(buildTurnContextSources({})).toEqual([])
  })

  it('三类来源合并且保持 kb / skill / rule 的顺序', () => {
    const sources = buildTurnContextSources({
      kbEntries: [kbEntry()],
      abilities: [ability()],
      ruleFiles: [{ source: 'project', name: 'AGENTS.md', path: 'K:/repo/AGENTS.md', content: 'x' }]
    })
    expect(sources.map((source) => source.kind)).toEqual(['kb', 'skill', 'rule'])
  })
})
