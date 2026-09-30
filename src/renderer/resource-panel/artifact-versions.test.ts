import { describe, expect, it } from 'vitest'
import type { FileVersionRecord } from '../../shared/types'
import { artifactOriginLabel, continueEditPrompt, restoreAvailability, versionOperationLabel, versionStatsLabel } from './artifact-versions'

function version(patch: Partial<FileVersionRecord> = {}): FileVersionRecord {
  return { turnId: 't1', runId: 'r1', conversationId: 'c1', operation: 'update', additions: 12, deletions: 3, hasDiff: true, canRestore: true, changedAt: 1, ...patch }
}

describe('versionOperationLabel', () => {
  it('四种操作各有标签', () => {
    expect((['create', 'update', 'delete', 'rename'] as const).map((operation) => versionOperationLabel({ operation })))
      .toEqual(['新建', '修改', '删除', '重命名'])
  })
})

describe('versionStatsLabel', () => {
  it('分别显示增删', () => {
    expect(versionStatsLabel(version())).toBe('+12 -3')
    expect(versionStatsLabel(version({ deletions: 0 }))).toBe('+12')
  })

  it('比不出行数时给空串，不编造 0', () => {
    expect(versionStatsLabel(version({ additions: 0, deletions: 0 }))).toBe('')
  })
})

describe('restoreAvailability', () => {
  it('存过原文才可恢复', () => {
    expect(restoreAvailability(version()).enabled).toBe(true)
  })

  it('不可恢复时给出具体原因', () => {
    const result = restoreAvailability(version({ canRestore: false }))
    expect(result.enabled).toBe(false)
    expect(result.reason).toContain('没有留下改动前的原文')
  })
})

describe('continueEditPrompt', () => {
  it('用 @ 引用文件，复用输入框既有的补全语义', () => {
    expect(continueEditPrompt('docs/plan.md')).toBe('继续修改 @docs/plan.md：')
  })
})

describe('artifactOriginLabel', () => {
  it('给出写出它的工具', () => {
    expect(artifactOriginLabel({ source: 'write' })).toBe('由 write 写出')
  })

  it('子任务委派单独标出', () => {
    expect(artifactOriginLabel({ source: 'edit', taskId: 'task-1' })).toBe('由 edit 写出 · 来自子任务委派')
  })

  it('只有运行 id 时说明是 Agent 写的，什么都没有时如实说未记录', () => {
    expect(artifactOriginLabel({ agentRunId: 'r1' })).toBe('由 Agent 运行写出')
    expect(artifactOriginLabel({})).toBe('来源未记录')
  })
})
