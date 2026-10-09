import { describe, expect, it } from 'vitest'
import { SUBAGENT_MAX_TOOL_CALLS_CEILING } from '../../shared/subagent'
import { draftToSubAgent, draftWriteHasNoTools, emptySubAgentDraft, subAgentToDraft, upsertSubAgent, validateSubAgentDraft, type CustomSubAgent, type SubAgentDraft } from './subagent-draft'

const agent = (id: string, extra: Partial<CustomSubAgent> = {}): CustomSubAgent => ({ id, name: id, description: '', systemPrompt: 'p', ...extra })
const draft = (extra: Partial<SubAgentDraft> = {}): SubAgentDraft => ({ ...emptySubAgentDraft(), id: 'api-reviewer', name: 'API', systemPrompt: '审查', ...extra })

describe('Sub-agent 草稿', () => {
  it('合法草稿没有错误', () => {
    expect(validateSubAgentDraft(draft(), [], null)).toEqual({})
  })

  it('ID 格式、内置占用与重复都要报错', () => {
    expect(validateSubAgentDraft(draft({ id: 'A' }), [], null).id).toBeTruthy()
    expect(validateSubAgentDraft(draft({ id: 'scout' }), [], null).id).toContain('内置')
    expect(validateSubAgentDraft(draft({ id: 'dup' }), [agent('dup')], null).id).toContain('已有')
    // 编辑自己时 id 不变不算重复
    expect(validateSubAgentDraft(draft({ id: 'dup' }), [agent('dup')], 'dup').id).toBeUndefined()
    // 编辑时改成别的已有角色的 id 仍算重复
    expect(validateSubAgentDraft(draft({ id: 'other' }), [agent('dup'), agent('other')], 'dup').id).toContain('已有')
  })

  it('名称与系统指令只有空白时报错', () => {
    const errors = validateSubAgentDraft(draft({ name: '  ', systemPrompt: '\n' }), [], null)
    expect(errors.name).toBeTruthy()
    expect(errors.systemPrompt).toBeTruthy()
  })

  it('工具调用上限必须是范围内整数或留空', () => {
    expect(validateSubAgentDraft(draft({ maxToolCalls: '' }), [], null).maxToolCalls).toBeUndefined()
    expect(validateSubAgentDraft(draft({ maxToolCalls: 10 }), [], null).maxToolCalls).toBeUndefined()
    expect(validateSubAgentDraft(draft({ maxToolCalls: 0 }), [], null).maxToolCalls).toBeTruthy()
    expect(validateSubAgentDraft(draft({ maxToolCalls: 2.5 }), [], null).maxToolCalls).toBeTruthy()
    expect(validateSubAgentDraft(draft({ maxToolCalls: SUBAGENT_MAX_TOOL_CALLS_CEILING + 1 }), [], null).maxToolCalls).toBeTruthy()
    expect(validateSubAgentDraft(draft({ maxToolCalls: Number.NaN }), [], null).maxToolCalls).toBeTruthy()
  })

  it('关闭写入的角色回填草稿时裁掉写类工具', () => {
    expect(subAgentToDraft(agent('x', { tools: ['read', 'edit', 'shell'], allowWrite: false })).tools).toEqual(['read'])
    expect(subAgentToDraft(agent('x', { tools: ['read', 'edit'], allowWrite: true })).tools).toEqual(['read', 'edit'])
    expect(subAgentToDraft(agent('x')).tools).toEqual(['read', 'grep', 'find', 'ls'])
  })

  it('保存时去掉首尾空白、补齐只读工具、关闭写入时不带写类工具', () => {
    const saved = draftToSubAgent(draft({ name: ' API ', tools: ['edit'], allowWrite: false, maxToolCalls: '' }))
    expect(saved.name).toBe('API')
    expect(saved.tools).toEqual(['read', 'grep', 'find', 'ls'])
    expect('maxToolCalls' in saved).toBe(false)
    expect(draftToSubAgent(draft({ tools: ['shell'], allowWrite: true, maxToolCalls: 12 }))).toMatchObject({ tools: ['read', 'grep', 'find', 'ls', 'shell'], maxToolCalls: 12 })
  })

  it('允许写入但没勾写类工具时给出提示', () => {
    expect(draftWriteHasNoTools(draft({ allowWrite: true }))).toBe(true)
    expect(draftWriteHasNoTools(draft({ allowWrite: true, tools: ['read', 'edit'] }))).toBe(false)
    expect(draftWriteHasNoTools(draft({ allowWrite: false }))).toBe(false)
  })

  it('新建追加，编辑原地替换，改 id 不留旧条目', () => {
    const list = [agent('a'), agent('b'), agent('c')]
    expect(upsertSubAgent(list, agent('d'), null).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(upsertSubAgent(list, agent('b', { name: 'B2' }), 'b').map((item) => item.name)).toEqual(['a', 'B2', 'c'])
    expect(upsertSubAgent(list, agent('b2'), 'b').map((item) => item.id)).toEqual(['a', 'b2', 'c'])
  })
})
