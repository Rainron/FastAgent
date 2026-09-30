export interface LocalMcpServer {
  id: string
  name: string
  transport: 'stdio' | 'streamable_http'
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  enabled: boolean
  timeoutMs: number
  hasSecrets: boolean
}

export interface LocalMcpServerInput extends Omit<LocalMcpServer, 'hasSecrets'> {
  env?: Record<string, string>
  headers?: Record<string, string>
}

export interface McpToolDescriptor {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

export interface McpTestStatus {
  testedAt: string
  ok: boolean
  error?: string | null
  toolCount: number
  tools: McpToolDescriptor[]
}

export interface LocalSkillRecord {
  name: string
  description: string
  filePath: string
  enabled: boolean
  version?: string
  author?: string
}

export type AbilityType = 'skill' | 'mcp' | 'cli'
export type AbilitySource = 'builtin' | 'marketplace' | 'imported' | 'created'
export type AbilityStatus = 'ready' | 'disabled' | 'error' | 'config_required' | 'update_available'

export interface AbilityError {
  code?: string
  message: string
}

export interface Ability {
  /** skill 用 name；mcp 用 server id */
  id: string
  name: string
  displayName: string
  description?: string
  type: AbilityType
  source: AbilitySource
  enabled: boolean
  status: AbilityStatus
  version?: string
  author?: string
  pluginId?: string
  localPath?: string
  installedAt?: string
  updatedAt?: string
  /** P0 恒为 undefined，字段预留给「最近使用」 */
  lastUsedAt?: string
  error?: AbilityError
}

export interface SkillAbility extends Ability {
  type: 'skill'
  filePath: string
  /** 内置 Skill 不显示卸载 */
  builtin: boolean
}

export interface McpConnectionSnapshot {
  state: 'connected' | 'disconnected' | 'error' | 'unknown'
  testedAt?: string
  error?: string | null
  toolCount: number
  resourceCount: number
  promptCount: number
  tools: McpToolDescriptor[]
}

export interface McpAbility extends Ability {
  type: 'mcp'
  transport: 'stdio' | 'streamable_http'
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  timeoutMs: number
  hasSecrets: boolean
  connection: McpConnectionSnapshot
}

/** CLI 能力的可用性探测结果，等价于 MCP 的连接快照。 */
export interface CliToolCheck {
  checkedAt: string
  ok: boolean
  version?: string | null
  error?: string | null
}

/**
 * Doctor 单项结论。
 * missing 与 error 分开：前者是「没装」（用户去装即可），后者是「装了但探不动」（超时、权限、损坏），
 * 两者的下一步动作完全不同，合成一档会让用户不知道该干什么。
 */
export type DoctorStatus = 'ok' | 'warn' | 'missing' | 'error'

export type DoctorCategory = 'toolchain' | 'shell' | 'sandbox' | 'workspace' | 'abilities'

export interface DoctorCheck {
  id: string
  label: string
  category: DoctorCategory
  status: DoctorStatus
  detail: string
  version?: string | null
  /** 非 ok 时给出的下一步动作；没有可操作建议时省略。 */
  hint?: string
}

export interface DoctorReport {
  checkedAt: number
  checks: DoctorCheck[]
  summary: Record<DoctorStatus, number>
  /** 整体结论，取所有单项里最严重的一档。 */
  overall: DoctorStatus
}

export interface LocalCliTool {
  id: string
  name: string
  description?: string
  /** 可执行文件名或绝对路径 */
  executable: string
  /** 探测版本用的参数，默认 ['--version'] */
  versionArgs: string[]
  /** 启用后写进 shell 权限规则的命令模式，必须通过 permission-rules 的安全校验 */
  allowPatterns: string[]
  /** 注入系统提示的一段用法说明，让模型知道这个命令能干什么 */
  usage?: string
  enabled: boolean
}

export interface CliAbility extends Ability {
  type: 'cli'
  executable: string
  versionArgs: string[]
  allowPatterns: string[]
  usage?: string
  check: CliToolCheck | null
}

export interface CliToolDetail {
  tool: LocalCliTool
  check: CliToolCheck | null
  source: AbilitySource
  sourceId?: string
  installedAt?: string
}

export interface AbilityInstallMeta {
  abilityType: AbilityType
  abilityId: string
  source: AbilitySource
  pluginId?: string
  /** 来自哪个 Hub 源。source 只区分「目录 / 导入 / 自建」，装自哪个第三方仓库是独立的信任信号。 */
  sourceId?: string
  version?: string
  installedAt: string
  updatedAt: string
  lastUsedAt?: string
  useCount: number
  /** 上次检查更新时远端的最新版本；未检查过时为空 */
  latestVersion?: string
  latestCheckedAt?: string
}

export type AgentAbilityMode = 'all_enabled' | 'selected'

export interface AgentAbilityPolicy {
  mode: AgentAbilityMode
  agentAbilityIds: string[]
}

export interface SkillFileNode {
  path: string
  size: number
}

export interface SkillDetail extends LocalSkillRecord {
  instructions: string
  files: SkillFileNode[]
  source: AbilitySource
  pluginId?: string
  installedAt?: string
  builtin: boolean
  /** 前言 allowed-tools 声明的工具；未声明时为空数组。 */
  requiredTools: string[]
  /** 声明了但当前环境不可用的工具。 */
  missingTools: string[]
}

/** 静态校验的一条结论。error 会让 ok 为 false，warning 与 info 只提示。 */
export interface SkillCheckIssue {
  level: 'error' | 'warning' | 'info'
  message: string
  hint?: string
}

/**
 * Skill 静态校验结果。只检查配置与依赖，不启动模型也不执行脚本——
 * 通过不代表这个 Skill 真的能完成任务。
 */
export interface SkillCheckResult {
  ok: boolean
  requiredTools: string[]
  missingTools: string[]
  issues: SkillCheckIssue[]
}

/** 一份历史版本快照：每次改写 SKILL.md 之前把旧内容存下来，供回退。 */
export interface SkillVersionRecord {
  name: string
  /** 自增修订号，越大越新。 */
  revision: number
  /** 前言里标注的版本号；未标注为 null。 */
  version: string | null
  description: string
  createdAt: number
  /** 产生这份快照的动作。 */
  reason: 'edit' | 'import' | 'revert'
}

/** 蒸馏产出的 SKILL.md 草稿；确认前可编辑，落库走 skills.create。 */
export interface SkillDraft {
  name: string
  description: string
  instructions: string
}

export interface McpSecretKeyInfo {
  key: string
  hasValue: boolean
}

export interface McpServerDetail {
  server: LocalMcpServer
  connection: McpConnectionSnapshot
  source: AbilitySource
  pluginId?: string
  installedAt?: string
  /** 只回传 key 与是否有值，绝不回传密钥值 */
  envKeys: McpSecretKeyInfo[]
  headerKeys: McpSecretKeyInfo[]
}
