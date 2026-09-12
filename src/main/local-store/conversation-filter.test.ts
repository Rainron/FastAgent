import { describe, expect, it } from 'vitest'
import { conversationFilter } from './conversation-filter'

function filter(query: Parameters<typeof conversationFilter>[1], archived = false) {
  return conversationFilter('account-a', query, archived)
}

describe('conversationFilter', () => {
  it('不筛时只带 namespace 与归档条件，不拼相关子查询', () => {
    const { where, params } = filter({})
    expect(where).not.toContain('conversation_turns')
    expect(params).toEqual(['account-a', 0, null, null, null, null])
  })

  it('关键词与项目条件按占位符成对传参', () => {
    const { params } = filter({ keyword: '  报告  ', projectId: 'project-1' })
    expect(params).toEqual(['account-a', 0, '报告', '报告', 'project-1', 'project-1'])
  })

  it('空白关键词按不筛处理', () => {
    expect(filter({ keyword: '   ' }).params[2]).toBeNull()
  })

  it("projectScope 为 all 时不额外加条件", () => {
    const { where, params } = filter({ projectScope: 'all' })
    expect(where).not.toContain('project_id IS NULL')
    expect(params).toHaveLength(6)
  })

  it('projectScope 为 unassigned 时筛无项目会话且不多传参数', () => {
    const { where, params } = filter({ projectScope: 'unassigned' })
    expect(where).toContain('project_id IS NULL')
    expect(params).toHaveLength(6)
  })

  it('projectScope 为具体项目时作为参数追加', () => {
    const { where, params } = filter({ projectScope: 'project-9' })
    expect(where).toContain('project_id = ?')
    expect(params[params.length - 1]).toBe('project-9')
  })

  it('模式与状态各自拼一次子查询并按顺序追加参数', () => {
    const { where, params } = filter({ mode: 'agent', status: 'failed' })
    expect(where).toContain('conversation_turns')
    expect(params.slice(-2)).toEqual(['agent', 'failed'])
  })

  it('只筛状态时不拼模式子查询', () => {
    const { where } = filter({ status: 'idle' })
    expect(where).toContain("'idle'")
    expect(where).not.toContain("WHEN 'agent' THEN 'agent'")
  })

  it('归档标志进第二个参数', () => {
    expect(filter({}, true).params[1]).toBe(1)
  })
})
