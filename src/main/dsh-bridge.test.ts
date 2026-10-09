import { describe, expect, it } from 'vitest'
import type { DshPluginActivation, DshToolSummary } from '../shared/types'
import { isReservedToolName, selectDshBindings } from './dsh-bridge'

const tool = (name: string): DshToolSummary => ({ name, description: `${name} 工具`, parameters: { type: 'object', properties: {} } })

describe('dsh 工具接入', () => {
  it('内置工具名与保留前缀不让插件占用', () => {
    for (const name of ['bash', 'read', 'edit', 'write', 'powershell', 'todowrite', 'skill', 'subagent', 'mcp__x__y', 'cli__git', 'computer_click']) {
      expect(isReservedToolName(name), name).toBe(true)
    }
    expect(isReservedToolName('find_dsh_plugin')).toBe(false)
  })

  it('保留名与后挂载插件的同名工具不接入，并记回激活结果', () => {
    const activations: Record<string, DshPluginActivation> = {
      'plugin-a': { status: 'active', tools: [tool('search_web'), tool('bash')] },
      'plugin-b': { status: 'active', tools: [tool('search_web'), tool('summarize')] },
      'plugin-c': { status: 'inactive', missingServices: ['settings'] }
    }
    const { bindings, activations: next } = selectDshBindings(activations)
    expect(bindings.map((binding) => `${binding.pluginName}:${binding.name}`)).toEqual(['plugin-a:search_web', 'plugin-b:summarize'])
    expect(next['plugin-a']).toEqual({ status: 'active', tools: [tool('search_web')], conflicts: ['bash'] })
    expect(next['plugin-b']).toEqual({ status: 'active', tools: [tool('summarize')], conflicts: ['search_web'] })
    expect(next['plugin-c']).toEqual(activations['plugin-c'])
  })

  it('没有冲突时激活结果不带 conflicts 字段', () => {
    const { bindings, activations } = selectDshBindings({ only: { status: 'active', tools: [tool('find_dsh_plugin')] } })
    expect(bindings).toHaveLength(1)
    expect(activations.only).toEqual({ status: 'active', tools: [tool('find_dsh_plugin')] })
  })
})
