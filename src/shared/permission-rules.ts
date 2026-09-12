// 权限规则内核：主进程与渲染进程共用，无 Node/Electron 依赖。

import { matchPattern } from './pattern-matcher'

export type PermissionAction = 'allow' | 'ask' | 'deny'

export interface PermissionRule {
  /** 工具参数模式，支持 * 与 ?；'*' 表示该工具的默认动作 */
  pattern: string
  action: PermissionAction
}

/** key: 逻辑工具名；'*' 键为全局兜底规则集 */
export type PermissionRuleSet = Record<string, PermissionRule[]>

/** 逻辑工具名（与 pi 实际工具名解耦） */
export type LogicalToolKey = 'read' | 'search' | 'edit' | 'shell' | 'question' | 'todowrite' | 'mcp_read' | 'mcp_write' | 'external_directory' | 'secret_file'

/** pi 工具名 → 逻辑工具名 */
export const TOOL_KEY_MAP: Record<string, LogicalToolKey> = {
  read: 'read',
  grep: 'search',
  find: 'search',
  ls: 'search',
  edit: 'edit',
  write: 'edit',
  patch: 'edit',
  bash: 'shell',
  powershell: 'shell',
  question: 'question',
  todowrite: 'todowrite',
}

export function logicalToolKey(toolName: string): string {
  return TOOL_KEY_MAP[toolName] ?? toolName
}

/** 全局禁止规则：三档预设都必须生效，且不因档位放宽（full）而失效。 */
export const GLOBAL_DENY_RULES: PermissionRule[] = [
  { pattern: 'rm -rf *', action: 'deny' },
  { pattern: 'git push --force*', action: 'deny' },
  { pattern: 'shutdown*', action: 'deny' },
  { pattern: 'format *', action: 'deny' }
]

/** 复合命令片段：出现就不泛化，否则 `mvn -v && rm -rf x` 会被一条 `mvn *` 全放行。 */
const SHELL_OPERATOR = /[|&;<>`\n]|\$\(/

/** GLOBAL_DENY_RULES 覆盖的可执行名：泛化成 `git *` 会盖掉 `git push --force*`，这些一律保持精确匹配。 */
const NON_GENERALIZABLE_EXECUTABLES = new Set(
  GLOBAL_DENY_RULES.map((rule) => rule.pattern.split(/\s+/)[0].replace(/\*+$/, ''))
)

/**
 * 「始终允许 / 本次会话允许」要落的规则模式。
 *
 * shell 按可执行名泛化：只记原始命令串的话，用户每换一个参数都要重新批一次，
 * 表现就是「点了始终允许还在弹批准」。复合命令与全局禁止清单里的可执行名不泛化。
 * 返回两条是因为 glob 里 `mvn *` 匹配不到裸命令 `mvn`。
 */
export function alwaysAllowPatterns(toolKey: string, subject: string): string[] {
  const command = subject.trim()
  if (!command) return ['*']
  if (toolKey !== 'shell' || SHELL_OPERATOR.test(command)) return [command]
  const executable = command.split(/\s+/)[0]
  if (!executable || NON_GENERALIZABLE_EXECUTABLES.has(executable)) return [command]
  return [executable, `${executable} *`]
}

/** 计划模式下仍放行的只读命令：只够用来看现状，不产生任何改动。 */
export const PLAN_MODE_SHELL_ALLOW = ['git status', 'git status *', 'git diff', 'git diff *', 'git log', 'git log *', 'git show', 'git show *']

/** 计划模式禁止的写入类逻辑工具，只留查询类。 */
const PLAN_MODE_DENY_KEYS = new Set(['edit', 'mcp_write', 'external_directory'])

/**
 * 计划模式硬约束：'deny' 表示该调用无条件拒绝，null 表示交回常规权限解析。
 *
 * 独立于 ruleSet 存在，因为规则集是 last-match-wins 的：用户自己存的 allow 规则或会话级
 * 「始终允许」都会压过预设，只有放在规则解析之外才拦得住。
 */
export function planModeAction(toolKey: string, subject: string): PermissionAction | null {
  if (PLAN_MODE_DENY_KEYS.has(toolKey)) return 'deny'
  if (toolKey !== 'shell') return null
  return PLAN_MODE_SHELL_ALLOW.some((pattern) => matchPattern(pattern, subject.trim())) ? null : 'deny'
}

/** 私钥类文件在所有档位都直接拒绝。 */
export const PRIVATE_KEY_RULES: PermissionRule[] = [
  { pattern: '*.pem', action: 'deny' },
  { pattern: '*.key', action: 'deny' },
  { pattern: 'id_rsa*', action: 'deny' },
  { pattern: 'id_ed25519*', action: 'deny' }
]

function shellRules(extraAllows: PermissionRule[], defaultAction: PermissionAction): PermissionRule[] {
  return [
    ...extraAllows,
    ...GLOBAL_DENY_RULES,
    { pattern: '*', action: defaultAction }
  ]
}

export function presetRuleSet(preset: 'ask' | 'workspace' | 'full'): PermissionRuleSet {
  const secretFile: PermissionRule[] = [...PRIVATE_KEY_RULES, { pattern: '*', action: 'ask' }]
  // 完全访问档下密钥文件不再逐次确认；私钥仍由 PRIVATE_KEY_RULES 与安全守卫双重 deny。
  const secretFileFull: PermissionRule[] = [...PRIVATE_KEY_RULES, { pattern: '*', action: 'allow' }]
  if (preset === 'ask') {
    return {
      read: [{ pattern: '*', action: 'allow' }],
      search: [{ pattern: '*', action: 'allow' }],
      edit: [{ pattern: '*', action: 'ask' }],
      shell: shellRules([
        { pattern: 'git status*', action: 'allow' },
        { pattern: 'git diff*', action: 'allow' },
        { pattern: 'git log*', action: 'allow' }
      ], 'ask'),
      question: [{ pattern: '*', action: 'allow' }],
      todowrite: [{ pattern: '*', action: 'allow' }],
      mcp_read: [{ pattern: '*', action: 'allow' }],
      mcp_write: [{ pattern: '*', action: 'allow' }],
      external_directory: [{ pattern: '*', action: 'deny' }],
      secret_file: secretFile
    }
  }
  if (preset === 'workspace') {
    return {
      read: [{ pattern: '*', action: 'allow' }],
      search: [{ pattern: '*', action: 'allow' }],
      edit: [{ pattern: '*', action: 'allow' }],
      // last-match-wins：宽泛放行在前，不可逆/外发动作的 ask 在后压住宽泛模式，
      // deny（shellRules 末尾追加）再压住 ask。
      shell: shellRules([
        { pattern: 'git *', action: 'allow' },
        { pattern: 'npm *', action: 'allow' },
        { pattern: 'npx *', action: 'allow' },
        { pattern: 'pnpm *', action: 'allow' },
        { pattern: 'yarn *', action: 'allow' },
        { pattern: 'node *', action: 'allow' },
        { pattern: 'python *', action: 'allow' },
        { pattern: 'python3 *', action: 'allow' },
        { pattern: 'pip *', action: 'allow' },
        { pattern: 'pip3 *', action: 'allow' },
        { pattern: 'tsc *', action: 'allow' },
        { pattern: 'vitest *', action: 'allow' },
        { pattern: 'jest *', action: 'allow' },
        { pattern: 'eslint *', action: 'allow' },
        { pattern: 'prettier *', action: 'allow' },
        { pattern: 'mkdir *', action: 'allow' },
        { pattern: 'touch *', action: 'allow' },
        { pattern: 'cp *', action: 'allow' },
        { pattern: 'mv *', action: 'allow' },
        { pattern: 'echo *', action: 'allow' },
        { pattern: 'cat *', action: 'allow' },
        { pattern: 'ls *', action: 'allow' },
        { pattern: 'dir *', action: 'allow' },
        { pattern: 'git push*', action: 'ask' },
        { pattern: 'git reset --hard*', action: 'ask' },
        { pattern: 'git clean*', action: 'ask' },
        { pattern: 'rm *', action: 'ask' },
        { pattern: 'del *', action: 'ask' },
        { pattern: 'rd *', action: 'ask' },
        { pattern: 'Remove-Item *', action: 'ask' },
        { pattern: 'npm publish*', action: 'ask' },
        { pattern: 'curl *', action: 'ask' },
        { pattern: 'wget *', action: 'ask' },
        { pattern: 'Invoke-WebRequest *', action: 'ask' },
        { pattern: 'Invoke-RestMethod *', action: 'ask' },
        { pattern: 'ssh *', action: 'ask' },
        { pattern: 'scp *', action: 'ask' }
      ], 'allow'),
      question: [{ pattern: '*', action: 'allow' }],
      todowrite: [{ pattern: '*', action: 'allow' }],
      mcp_read: [{ pattern: '*', action: 'allow' }],
      mcp_write: [{ pattern: '*', action: 'allow' }],
      external_directory: [{ pattern: '*', action: 'ask' }],
      secret_file: secretFile
    }
  }
  return {
    read: [{ pattern: '*', action: 'allow' }],
    search: [{ pattern: '*', action: 'allow' }],
    edit: [{ pattern: '*', action: 'allow' }],
    shell: shellRules([], 'allow'),
    question: [{ pattern: '*', action: 'allow' }],
    todowrite: [{ pattern: '*', action: 'allow' }],
    mcp_read: [{ pattern: '*', action: 'allow' }],
    mcp_write: [{ pattern: '*', action: 'allow' }],
    // 完全访问：工作区外读取也放行；技能文件在应用数据目录、工作区外，保留 ask 会让每次加载技能都弹窗。
    external_directory: [{ pattern: '*', action: 'allow' }],
    secret_file: secretFileFull
  }
}

/** 严重度排序：deny < ask < allow，取更严者用于多路判定合并。 */
const ACTION_RANK: Record<PermissionAction, number> = { deny: 0, ask: 1, allow: 2 }

export function stricterAction(actions: PermissionAction[]): PermissionAction {
  let rank = 2
  for (const action of actions) {
    const current = ACTION_RANK[action]
    if (current < rank) rank = current
  }
  return rank === 2 ? 'allow' : rank === 1 ? 'ask' : 'deny'
}

export const PERMISSION_PRESETS = ['ask', 'workspace', 'full'] as const