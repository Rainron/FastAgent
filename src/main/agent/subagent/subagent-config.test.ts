import { describe, expect, it } from 'vitest'
import { builtInSubAgents, clampSubAgentMaxToolCalls, describeSubAgentRoster, normalizeCustomSubAgents, resolveSubAgentConfig, validateSubAgentTask } from './subagent-config'
import { SUBAGENT_LIMITS } from './subagent-types'

describe('subagent config', () => {
  it('提供只读内置角色', () => {
    expect(builtInSubAgents().map((item) => item.id)).toEqual(['scout', 'reviewer'])
    expect(resolveSubAgentConfig('scout')?.tools).toEqual(['read', 'grep', 'find', 'ls'])
    expect(resolveSubAgentConfig('scout')?.allowWrite).toBe(false)
  })

  it('规范化自定义角色并强制只读能力', () => {
    const result = normalizeCustomSubAgents([{ id: 'custom', name: '自定义', description: 'x', systemPrompt: '只读', tools: ['write'], allowWrite: true, allowMcp: true, maxToolCalls: 9999 }])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ tools: ['read', 'grep', 'find', 'ls'], allowWrite: false, allowMcp: false, maxToolCalls: SUBAGENT_LIMITS.maxToolCallsCeiling })
    expect(normalizeCustomSubAgents([{ id: 'scout', name: '覆盖', systemPrompt: 'x' }, { id: 'bad id', name: 'x', systemPrompt: 'x' }])).toEqual([])
  })

  it('没声明上限的角色不写死数字，跟随设置里的全局默认', () => {
    // 写死了全局设置对它就永远失效；内置角色同理
    const [plain] = normalizeCustomSubAgents([{ id: 'plain', name: '普通角色', systemPrompt: '只读' }])
    expect(plain.maxToolCalls).toBeUndefined()
    expect(builtInSubAgents().every((agent) => agent.maxToolCalls === undefined)).toBe(true)
  })

  it('旧配置里的 maxTurns 当成工具调用上限读进来', () => {
    // maxTurns 从来没传给子运行，属于死配置；迁移期按同一个数字读，别把用户既有设置丢成默认值
    const [legacy] = normalizeCustomSubAgents([{ id: 'legacy', name: '旧角色', systemPrompt: '只读', maxTurns: 6 }])
    expect(legacy.maxToolCalls).toBe(6)
    const [both] = normalizeCustomSubAgents([{ id: 'both', name: '新旧并存', systemPrompt: '只读', maxTurns: 6, maxToolCalls: 12 }])
    expect(both.maxToolCalls).toBe(12)
  })

  it('角色清单包含内置与自定义角色，缺描述时回落到名称', () => {
    const roster = describeSubAgentRoster(normalizeCustomSubAgents([{ id: 'auditor', name: 'API 审查员', description: '', systemPrompt: '只读审计' }]))
    expect(roster).toContain('- scout：分析代码库、调用链和相关文件')
    expect(roster).toContain('- reviewer：')
    expect(roster).toContain('- auditor：API 审查员')
  })

  it('工具调用上限裁进可配区间，非法值回落推荐值', () => {
    expect(clampSubAgentMaxToolCalls(60)).toBe(60)
    expect(clampSubAgentMaxToolCalls(0)).toBe(1)
    expect(clampSubAgentMaxToolCalls(99999)).toBe(SUBAGENT_LIMITS.maxToolCallsCeiling)
    expect(clampSubAgentMaxToolCalls(12.6)).toBe(13)
    for (const bad of [undefined, null, NaN, Infinity, '40']) {
      expect(clampSubAgentMaxToolCalls(bad)).toBe(SUBAGENT_LIMITS.defaultMaxToolCalls)
    }
  })

  it('校验任务边界', () => {
    expect(validateSubAgentTask('  ', 10)).toContain('不能为空')
    expect(validateSubAgentTask('12345', 4)).toContain('超过')
    expect(validateSubAgentTask('读取调用链', 10)).toBeNull()
  })
})
