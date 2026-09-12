import type { SubAgentConfig } from './subagent-types'

const READONLY_TOOLS = ['read', 'grep', 'find', 'ls']

const BUILTIN: SubAgentConfig[] = [
  {
    id: 'scout',
    name: 'scout',
    description: '分析代码库、调用链和相关文件',
    systemPrompt: '你是代码侦察 Sub-agent。只阅读和分析，不修改文件，不执行写入命令。',
    tools: READONLY_TOOLS,
    allowWrite: false,
    allowMcp: false,
    thinkingLevel: 'low',
    maxTurns: 8
  },
  {
    id: 'reviewer',
    name: 'reviewer',
    description: '检查局部代码质量、回归风险和验证缺口',
    systemPrompt: '你是代码审查 Sub-agent。只阅读和分析，不修改文件，不执行写入命令。',
    tools: READONLY_TOOLS,
    allowWrite: false,
    allowMcp: false,
    thinkingLevel: 'low',
    maxTurns: 8
  }
]

export const SUBAGENT_HANDOFF_PROMPT = `请严格按以下格式交接，区分事实、推断和建议：
## 目标
## 已验证项
## 未验证项
## 关键发现
## 关键决定
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
      maxTurns: Math.min(12, Math.max(1, Number(candidate.maxTurns) || 8))
    }]
  })
}

export function validateSubAgentTask(task: string, maxCharacters: number): string | null {
  const value = task.trim()
  if (!value) return 'Sub-agent 任务不能为空'
  if (value.length > maxCharacters) return `Sub-agent 任务超过 ${maxCharacters} 字符限制`
  return null
}
