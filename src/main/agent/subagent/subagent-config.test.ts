import { describe, expect, it } from 'vitest'
import { builtInSubAgents, describeSubAgentRoster, normalizeCustomSubAgents, resolveSubAgentConfig, validateSubAgentTask } from './subagent-config'

describe('subagent config', () => {
  it('提供只读内置角色', () => {
    expect(builtInSubAgents().map((item) => item.id)).toEqual(['scout', 'reviewer'])
    expect(resolveSubAgentConfig('scout')?.tools).toEqual(['read', 'grep', 'find', 'ls'])
    expect(resolveSubAgentConfig('scout')?.allowWrite).toBe(false)
  })

  it('规范化自定义角色并强制只读能力', () => {
    const result = normalizeCustomSubAgents([{ id: 'custom', name: '自定义', description: 'x', systemPrompt: '只读', tools: ['write'], allowWrite: true, allowMcp: true, maxTurns: 99 }])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ tools: ['read', 'grep', 'find', 'ls'], allowWrite: false, allowMcp: false, maxTurns: 12 })
    expect(normalizeCustomSubAgents([{ id: 'scout', name: '覆盖', systemPrompt: 'x' }, { id: 'bad id', name: 'x', systemPrompt: 'x' }])).toEqual([])
  })

  it('角色清单包含内置与自定义角色，缺描述时回落到名称', () => {
    const roster = describeSubAgentRoster(normalizeCustomSubAgents([{ id: 'auditor', name: 'API 审查员', description: '', systemPrompt: '只读审计' }]))
    expect(roster).toContain('- scout：分析代码库、调用链和相关文件')
    expect(roster).toContain('- reviewer：')
    expect(roster).toContain('- auditor：API 审查员')
  })

  it('校验任务边界', () => {
    expect(validateSubAgentTask('  ', 10)).toContain('不能为空')
    expect(validateSubAgentTask('12345', 4)).toContain('超过')
    expect(validateSubAgentTask('读取调用链', 10)).toBeNull()
  })
})
