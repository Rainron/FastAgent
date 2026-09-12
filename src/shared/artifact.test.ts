import { describe, expect, it } from 'vitest'
import { artifactKey, autoTitle, buildArtifactGroups, createArtifactId, inferArtifactType } from './artifact'
import type { Artifact } from './types'

function makeArtifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: createArtifactId(),
    workspaceId: 'D:/project',
    name: 'file.md',
    type: 'markdown',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('inferArtifactType', () => {
  it('按扩展名识别常见类型', () => {
    expect(inferArtifactType('notes.md')).toBe('markdown')
    expect(inferArtifactType('main.py')).toBe('code')
    expect(inferArtifactType('README.html')).toBe('html')
    expect(inferArtifactType('data.csv')).toBe('csv')
    expect(inferArtifactType('app.json')).toBe('json')
    expect(inferArtifactType('debug.log')).toBe('log')
    expect(inferArtifactType('fix.diff')).toBe('diff')
    expect(inferArtifactType('change.patch')).toBe('patch')
    expect(inferArtifactType('photo.png')).toBe('image')
    expect(inferArtifactType('manual.pdf')).toBe('document')
  })

  it('任务与结果文件按名字特征识别', () => {
    expect(inferArtifactType('task_plan.md')).toBe('plan')
    expect(inferArtifactType('test-result.md')).toBe('test-result')
    expect(inferArtifactType('build-result.txt')).toBe('build-result')
    expect(inferArtifactType('weekly-report.pdf')).toBe('report')
  })

  it('未知扩展名兜底为 generated-file', () => {
    expect(inferArtifactType('archive.xyz')).toBe('generated-file')
  })
})

describe('artifactKey', () => {
  it('同一工作区路径会话视为同一条，忽略其它字段', () => {
    expect(artifactKey('D:/p', 'a/b.md', 'c1')).toBe(artifactKey('D:/p', 'a/b.md', 'c1'))
    expect(artifactKey('D:/p', 'a/b.md', 'c1')).not.toBe(artifactKey('D:/p', 'a/b.md', 'c2'))
    expect(artifactKey('D:/p', 'a/b.md', 'c1')).not.toBe(artifactKey('D:/p', 'a/c.md', 'c1'))
  })
})

describe('autoTitle', () => {
  it('优先取来源，超长截断', () => {
    expect(autoTitle(makeArtifact({ source: '修复测试失败' }))).toBe('修复测试失败')
    expect(autoTitle(makeArtifact({ source: 'x'.repeat(40) }))).toBe(`${'x'.repeat(24)}…`)
  })

  it('无来源时从文件名去掉扩展名与分隔符', () => {
    expect(autoTitle(makeArtifact({ name: 'task_plan.md' }))).toBe('task plan')
    expect(autoTitle(makeArtifact({ name: 'notes.txt' }))).toBe('notes')
  })

  it('都没有时给兜底名', () => {
    expect(autoTitle(makeArtifact({ name: 'a.b.c' }))).toBe('a.b.c')
  })
})

describe('buildArtifactGroups', () => {
  const c1 = makeArtifact({ id: 'a1', conversationId: 'c1', name: 'plan.md', updatedAt: 30, createdAt: 30 })
  const c2 = makeArtifact({ id: 'a2', conversationId: 'c2', name: 'report.md', updatedAt: 20, createdAt: 20 })
  const ungrouped = makeArtifact({ id: 'a3', name: 'standalone.md', updatedAt: 10, createdAt: 10 })

  it('按会话分组并给出标题，组内按最新排序', () => {
    const groups = buildArtifactGroups([c1, c2], { titleForConversation: (id) => (id === 'c1' ? '分析项目架构' : null) })
    expect(groups.map((group) => group.id)).toEqual(['c1', 'c2'])
    expect(groups[0].name).toBe('分析项目架构')
    expect(groups[0].count).toBe(1)
    // c2 无标题回落自动生成
    expect(groups[1].name).toBe('report')
  })

  it('无归属进 Ungrouped 且恒排最后', () => {
    const groups = buildArtifactGroups([c1, ungrouped])
    expect(groups.map((group) => group.id)).toEqual(['c1', 'ungrouped'])
    expect(groups[1].name).toBe('Ungrouped')
  })

  it('组间按最新条目时间降序，Ungrouped 恒排最后', () => {
    const groups = buildArtifactGroups([c1, c2, ungrouped])
    // 最新的是 c1(30)，其次是 c2(20)，最后 ungrouped(10)，但 Ungrouped 恒排最后
    expect(groups.map((group) => group.id)).toEqual(['c1', 'c2', 'ungrouped'])
  })

  it('当前会话组置顶，其余仍按最新时间降序', () => {
    // c2(20) 比 c1(30) 旧，但它是当前会话
    const groups = buildArtifactGroups([c1, c2, ungrouped], { pinnedConversationId: 'c2' })
    expect(groups.map((group) => group.id)).toEqual(['c2', 'c1', 'ungrouped'])
  })

  it('当前会话还没有产物时排序不受影响', () => {
    const groups = buildArtifactGroups([c1, c2], { pinnedConversationId: 'c9' })
    expect(groups.map((group) => group.id)).toEqual(['c1', 'c2'])
  })

  it('超过 limit 时最旧组并入更多组', () => {
    const groups = buildArtifactGroups([c1, c2, ungrouped], { limit: 2 })
    expect(groups.length).toBe(3)
    const last = groups[2]
    expect(last.id).toBe('more')
    expect(last.count).toBe(1)
  })
})

describe('createArtifactId', () => {
  it('生成带前缀的唯一 id', () => {
    const id = createArtifactId()
    expect(id.startsWith('artifact-')).toBe(true)
    expect(id).not.toBe(createArtifactId())
  })
})
