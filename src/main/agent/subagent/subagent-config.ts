import { isSubAgentWriteTool, SUBAGENT_READONLY_TOOL_IDS, SUBAGENT_TOOL_IDS } from '../../../shared/subagent'
import { SUBAGENT_LIMITS, type SubAgentConfig } from './subagent-types'

const READONLY_TOOLS: string[] = [...SUBAGENT_READONLY_TOOL_IDS]
const FULL_TOOLS: string[] = [...SUBAGENT_TOOL_IDS]

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
  },
  {
    id: 'builder',
    name: 'builder',
    description: '按已定方案实现局部改动，可改文件并执行命令自查',
    systemPrompt: '你是实现型 Sub-agent。严格按交接给你的方案修改指定文件：不扩大改动范围，不顺手重构或格式化无关代码，不新增未要求的功能。改完后按改动性质做相称的验证：代码改动复核 diff 并运行相关测试或类型检查；文档、文案等非代码文件读回一次确认内容即可，不要反复写脚本核对。把验证结果如实写进交接，没跑过的就写进未验证项。',
    tools: FULL_TOOLS,
    allowWrite: true,
    allowMcp: false,
    thinkingLevel: 'medium'
  },
  {
    id: 'verifier',
    name: 'verifier',
    description: '运行测试、类型检查等验证命令并归纳失败原因',
    systemPrompt: '你是验证型 Sub-agent。只运行测试、构建与类型检查等验证命令并阅读代码定位失败原因，不修改任何文件。如实报告命令、退出码与关键失败输出，不要为了让结果好看而跳过用例。',
    tools: [...READONLY_TOOLS, 'shell'],
    allowWrite: true,
    allowMcp: false,
    thinkingLevel: 'low'
  }
]

/** 内置角色 id：自定义角色不能占用，否则 resolveSubAgentConfig 永远命中内置那一条。 */
export const BUILTIN_SUBAGENT_IDS: readonly string[] = BUILTIN.map((config) => config.id)

/** 小节必须与 subagent-handoff.ts 的 HEADINGS 一一对应：少一节，那个字段就恒为空。 */
export const SUBAGENT_HANDOFF_PROMPT = `请严格按以下格式交接，区分事实、推断和建议。「改动文件」只写自己真正改过的文件路径，没改过就写「无」：
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
 * 把角色配置里的逻辑工具名展开成 pi 的工具白名单。
 *
 * `shell` 必须按会话的实际 shell 偏好落地：配置里写死 bash 的角色在只有 PowerShell 的机器上
 * 会白名单落空，等于没有命令能力。
 */
export function expandSubAgentTools(tools: string[], shellToolName: 'bash' | 'powershell'): string[] {
  return tools.map((tool) => tool === 'shell' ? shellToolName : tool)
}

/** 子运行是否需要离开计划模式：只看已授予的工具，避免 allowWrite 与 tools 各说一套。 */
export function subAgentCanWrite(config: Pick<SubAgentConfig, 'tools'>): boolean {
  return config.tools.some(isSubAgentWriteTool)
}

/**
 * 归一角色的工具清单。
 *
 * 只读工具一律补齐：连 read 都没有的角色拿到任务也只能瞎猜，而放开只读没有额外风险。
 * allowWrite 为假时写类工具整段裁掉——设置里关掉写入却在 tools 里留着 edit，
 * 归一后仍然可写，那个开关就是假的。
 */
export function normalizeSubAgentTools(value: unknown, allowWrite: boolean): string[] {
  const requested = new Set(Array.isArray(value) ? value.filter((tool): tool is string => typeof tool === 'string') : [])
  const granted = FULL_TOOLS.filter((tool) => requested.has(tool) && (allowWrite || !isSubAgentWriteTool(tool)))
  return FULL_TOOLS.filter((tool) => READONLY_TOOLS.includes(tool) || granted.includes(tool))
}

/**
 * 可委派角色清单，拼进 subagent 工具描述。agent 参数是自由字符串，清单不进提示词就等于
 * 模型只能猜 id：内置角色靠运气，用户自定义的角色永远不会被用到。
 *
 * 能力标注必须一起进清单：主 Agent 不知道哪个角色能改文件，就只会把实现任务全留给自己。
 */
export function describeSubAgentRoster(custom: SubAgentConfig[] = []): string {
  return [...builtInSubAgents(), ...custom]
    .map((config) => {
      const capability = subAgentCanWrite(config) ? `可写：${config.tools.join('、')}` : '只读'
      return `- ${config.id}：${config.description.trim() || config.name}（${capability}${config.allowMcp ? '；可用 MCP 工具' : ''}）`
    })
    .join('\n')
}

export function normalizeCustomSubAgents(value: unknown): SubAgentConfig[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Partial<SubAgentConfig>
    if (typeof candidate.id !== 'string' || !/^[a-z][a-z0-9_-]{1,31}$/.test(candidate.id) || BUILTIN_SUBAGENT_IDS.includes(candidate.id)) return []
    if (typeof candidate.name !== 'string' || typeof candidate.systemPrompt !== 'string') return []
    const allowWrite = candidate.allowWrite === true
    return [{
      id: candidate.id,
      name: candidate.name.slice(0, 80),
      description: typeof candidate.description === 'string' ? candidate.description.slice(0, 300) : '',
      systemPrompt: candidate.systemPrompt.slice(0, 4000),
      tools: normalizeSubAgentTools(candidate.tools, allowWrite),
      allowWrite,
      allowMcp: candidate.allowMcp === true,
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
