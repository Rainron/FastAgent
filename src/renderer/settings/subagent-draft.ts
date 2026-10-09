import type { AppSettings, ThinkingLevel } from '../../shared/types'
import { isSubAgentWriteTool, SUBAGENT_MAX_TOOL_CALLS_CEILING, SUBAGENT_READONLY_TOOL_IDS } from '../../shared/subagent'

export type CustomSubAgent = NonNullable<AppSettings['subAgents']>[number]

export interface SubAgentDraft {
  id: string
  name: string
  description: string
  systemPrompt: string
  thinkingLevel: ThinkingLevel
  tools: string[]
  allowWrite: boolean
  allowMcp: boolean
  maxToolCalls: number | ''
}

/** 内置角色 id 由主进程 BUILTIN_SUBAGENT_IDS 定义，这里只做提交前的即时校验提示。 */
export const RESERVED_SUBAGENT_IDS = ['scout', 'reviewer', 'builder', 'verifier']

/** 与主进程 normalizeCustomSubAgents 的截断长度一致：超出的部分存了也会被静默裁掉，不如输入时就挡住。 */
export const SUBAGENT_NAME_MAX = 80
export const SUBAGENT_DESCRIPTION_MAX = 300
export const SUBAGENT_PROMPT_MAX = 4000

// 不再写 maxTurns：轮次从来没有传给子运行，那个字段填多少都不生效。
// 真正的边界由主进程的 normalizeCustomSubAgents 按 maxToolCalls 补默认值。
export function emptySubAgentDraft(): SubAgentDraft {
  return {
    id: '',
    name: '',
    description: '',
    systemPrompt: '',
    thinkingLevel: 'low',
    tools: [...SUBAGENT_READONLY_TOOL_IDS],
    allowWrite: false,
    allowMcp: false,
    maxToolCalls: ''
  }
}

export function subAgentToDraft(agent: CustomSubAgent): SubAgentDraft {
  const allowWrite = agent.allowWrite === true
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description ?? '',
    systemPrompt: agent.systemPrompt,
    thinkingLevel: agent.thinkingLevel ?? 'low',
    tools: (agent.tools ?? [...SUBAGENT_READONLY_TOOL_IDS]).filter((tool) => allowWrite || !isSubAgentWriteTool(tool)),
    allowWrite,
    allowMcp: agent.allowMcp === true,
    maxToolCalls: typeof agent.maxToolCalls === 'number' ? agent.maxToolCalls : ''
  }
}

export type SubAgentDraftErrors = Partial<Record<'id' | 'name' | 'systemPrompt' | 'maxToolCalls', string>>

/**
 * 保存前的字段校验，格式与主进程 normalizeCustomSubAgents 保持一致，否则存了也会被主进程丢掉。
 * editingId 是正在编辑的原角色：改名到自己的 id 不算冲突，改到别的已有角色的 id 才算。
 */
export function validateSubAgentDraft(draft: SubAgentDraft, agents: CustomSubAgent[], editingId: string | null): SubAgentDraftErrors {
  const errors: SubAgentDraftErrors = {}
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(draft.id)) errors.id = '小写字母开头，2~32 位小写字母、数字、下划线或短横线'
  else if (RESERVED_SUBAGENT_IDS.includes(draft.id)) errors.id = `不能占用内置角色 ${RESERVED_SUBAGENT_IDS.join(' / ')}`
  else if (draft.id !== editingId && agents.some((agent) => agent.id === draft.id)) errors.id = '已有同 ID 的角色'
  if (!draft.name.trim()) errors.name = '请填写名称'
  if (!draft.systemPrompt.trim()) errors.systemPrompt = '请填写系统指令'
  if (draft.maxToolCalls !== '' && (!Number.isInteger(draft.maxToolCalls) || draft.maxToolCalls < 1 || draft.maxToolCalls > SUBAGENT_MAX_TOOL_CALLS_CEILING)) {
    errors.maxToolCalls = `填 1~${SUBAGENT_MAX_TOOL_CALLS_CEILING} 的整数，或留空`
  }
  return errors
}

/** 允许写入却一个写类工具都没勾：主进程按已授予的工具判定能否写，这个角色实际仍是只读。 */
export function draftWriteHasNoTools(draft: SubAgentDraft): boolean {
  return draft.allowWrite && !draft.tools.some(isSubAgentWriteTool)
}

export function draftToSubAgent(draft: SubAgentDraft): CustomSubAgent {
  return {
    id: draft.id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    systemPrompt: draft.systemPrompt.trim(),
    thinkingLevel: draft.thinkingLevel,
    // 只读工具主进程会补齐，这里显式带上，存下来的配置和界面看到的一致
    tools: [...new Set([...SUBAGENT_READONLY_TOOL_IDS, ...draft.tools.filter((tool) => draft.allowWrite || !isSubAgentWriteTool(tool))])],
    allowWrite: draft.allowWrite,
    allowMcp: draft.allowMcp,
    ...(typeof draft.maxToolCalls === 'number' ? { maxToolCalls: draft.maxToolCalls } : {})
  }
}

/** 编辑时原地替换，保住列表里的位置；新建的追加到末尾。改了 id 的要把旧条目一并换掉，不能留下两份。 */
export function upsertSubAgent(agents: CustomSubAgent[], next: CustomSubAgent, editingId: string | null): CustomSubAgent[] {
  const index = editingId === null ? -1 : agents.findIndex((agent) => agent.id === editingId)
  if (index < 0) return [...agents.filter((agent) => agent.id !== next.id), next]
  return agents.flatMap((agent, current) => current === index ? [next] : agent.id === next.id ? [] : [agent])
}
