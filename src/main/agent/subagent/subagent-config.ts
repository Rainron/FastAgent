import { SUBAGENT_LIMITS, type SubAgentConfig } from './subagent-types'

const READONLY_TOOLS = ['read', 'grep', 'find', 'ls']

/** 旧设置只有 maxTurns，且从未生效；迁移期按同一个数字当工具调用上限读。 */
function legacyMaxTurns(item: unknown): number | undefined {
  const value = (item as { maxTurns?: unknown }).maxTurns
  return typeof value === 'number' ? value : undefined
}

/** 角色没声明就不写这个键：缺省语义是「跟随设置里的全局默认」，写死数字会让全局设置对它失效。 */
function resolveDeclaredMaxToolCalls(value: unknown): { maxToolCalls?: number } {
  if (typeof value !== 'number' || !Number.isFinite(value)) return {}
  return { maxToolCalls: clampSubAgentMaxToolCalls(value) }
}

export function clampSubAgentMaxToolCalls(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), 1), SUBAGENT_LIMITS.maxToolCallsCeiling)
    : SUBAGENT_LIMITS.defaultMaxToolCalls
}

const BUILTIN: SubAgentConfig[] = [
  {
    id: 'scout',
    name: 'scout',
    description: '分析代码库、调用链和相关文件',
    systemPrompt: '你是代码侦察 Sub-agent。只阅读和分析，不修改文件，不执行写入命令。',
    tools: READONLY_TOOLS,
    allowWrite: false,
    allowMcp: false,
    thinkingLevel: 'low'
  },
  {
    id: 'reviewer',
    name: 'reviewer',
    description: '检查局部代码质量、回归风险和验证缺口',
    systemPrompt: '你是代码审查 Sub-agent。只阅读和分析，不修改文件，不执行写入命令。',
    tools: READONLY_TOOLS,
    allowWrite: false,
    allowMcp: false,
    thinkingLevel: 'low'
  }
]

/** 小节必须与 subagent-handoff.ts 的 HEADINGS 一一对应：少一节，那个字段就恒为空。 */
export const SUBAGENT_HANDOFF_PROMPT = `请严格按以下格式交接，区分事实、推断和建议：
## 目标
## 改动文件
## 已验证项
## 未验证项
## 关键发现
## 关键决定
## 建议
## 剩余步骤`

export function builtInSubAgents(): SubAgentConfig[] {
  return BUILTIN.map((config) => ({ ...config, tools: [...config.tools] }))
}

export function resolveSubAgentConfig(agentId: string, custom: SubAgentConfig[] = []): SubAgentConfig | null {
  return [...builtInSubAgents(), ...custom].find((config) => config.id === agentId) ?? null
}

/**
 * 可委派角色清单，拼进 subagent 工具描述。agent 参数是自由字符串，清单不进提示词就等于
 * 模型只能猜 id：内置两个角色靠运气，用户自定义的角色永远不会被用到。
 */
export function describeSubAgentRoster(custom: SubAgentConfig[] = []): string {
  return [...builtInSubAgents(), ...custom]
    .map((config) => `- ${config.id}：${config.description.trim() || config.name}`)
    .join('\n')
}

export function normalizeCustomSubAgents(value: unknown): SubAgentConfig[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Partial<SubAgentConfig>
    if (typeof candidate.id !== 'string' || !/^[a-z][a-z0-9_-]{1,31}$/.test(candidate.id) || candidate.id === 'scout' || candidate.id === 'reviewer') return []
    if (typeof candidate.name !== 'string' || typeof candidate.systemPrompt !== 'string') return []
    return [{
      id: candidate.id,
      name: candidate.name.slice(0, 80),
      description: typeof candidate.description === 'string' ? candidate.description.slice(0, 300) : '',
      systemPrompt: candidate.systemPrompt.slice(0, 4000),
      tools: ['read', 'grep', 'find', 'ls'],
      allowWrite: false,
      allowMcp: false,
      thinkingLevel: candidate.thinkingLevel === 'high' || candidate.thinkingLevel === 'medium' ? candidate.thinkingLevel : 'low',
      // 只在角色自己声明过时才带上：没声明的走设置里的 subAgentMaxToolCalls。
      // 旧设置里的 maxTurns 从来没生效过，迁移期按同一个数字当工具调用上限读。
      ...resolveDeclaredMaxToolCalls(candidate.maxToolCalls ?? legacyMaxTurns(item))
    }]
  })
}

export function validateSubAgentTask(task: string, maxCharacters: number): string | null {
  const value = task.trim()
  if (!value) return 'Sub-agent 任务不能为空'
  if (value.length > maxCharacters) return `Sub-agent 任务超过 ${maxCharacters} 字符限制`
  return null
}
