// 权限档位：内置三档 + 用户自定义档，主进程与渲染进程共用，无 Node/Electron 依赖。

import { GLOBAL_DENY_RULES, presetRuleSet, type PermissionAction, type PermissionRule, type PermissionRuleSet } from './permission-rules'

export type BuiltinPermissionPreset = 'ask' | 'workspace' | 'full'

/** 落库形态：只存被改过的 toolKey，未覆盖的键继续跟随 base 档的内置规则。 */
export interface StoredPermissionProfile {
  id: string
  label: string
  hint: string
  base: BuiltinPermissionPreset
  builtin: boolean
  overrides: PermissionRuleSet
  position: number
}

export interface PermissionProfile extends StoredPermissionProfile {
  shortLabel: string
  description: string
  risk: boolean
}

interface BuiltinMeta {
  label: string
  shortLabel: string
  hint: string
  description: string
  risk: boolean
}

export const BUILTIN_PRESET_IDS: BuiltinPermissionPreset[] = ['ask', 'workspace', 'full']

export const BUILTIN_PROFILE_META: Record<BuiltinPermissionPreset, BuiltinMeta> = {
  ask: { label: '受控模式', shortLabel: '受控', hint: '敏感操作前请求确认', description: '修改文件、执行命令或进行敏感操作前请求用户确认。', risk: false },
  workspace: { label: '工作区模式', shortLabel: '工作区', hint: '可修改当前项目并执行命令', description: '允许 Agent 在当前项目工作区内读取、修改文件以及执行命令。', risk: false },
  full: { label: '完全访问', shortLabel: '完全', hint: '访问本机资源并执行命令，不再询问', description: '允许 Agent 读写工作区外的本机文件、执行系统命令、安装依赖、联网及使用已启用能力，其间不再逐次询问；安全守卫仍会阻止高风险破坏操作与私钥文件读取。', risk: true }
}

export function isBuiltinPreset(id: string): id is BuiltinPermissionPreset {
  return (BUILTIN_PRESET_IDS as string[]).includes(id)
}

/**
 * 生效规则集：base 档的内置规则被 overrides 按 toolKey 整键替换。
 *
 * shell 末尾无条件补回 GLOBAL_DENY_RULES：解析是 last-match-wins，用户把 deny 条目从档位里
 * 删掉或改成 allow 后，全局禁止清单就失效了，这几条不接受档位覆盖。
 */
export function effectiveRuleSet(profile: Pick<StoredPermissionProfile, 'base' | 'overrides'>): PermissionRuleSet {
  const merged: PermissionRuleSet = { ...presetRuleSet(profile.base) }
  for (const [toolKey, rules] of Object.entries(profile.overrides)) merged[toolKey] = [...rules]
  const shell = (merged.shell ?? []).filter((rule) => !GLOBAL_DENY_RULES.some((deny) => deny.pattern === rule.pattern))
  // '*' 兜底必须留在最后一条，否则档位默认动作会被 deny 之后的扫描顺序改写。
  const fallback = shell.filter((rule) => rule.pattern === '*')
  merged.shell = [...shell.filter((rule) => rule.pattern !== '*'), ...GLOBAL_DENY_RULES, ...fallback]
  return merged
}

function decorate(stored: StoredPermissionProfile): PermissionProfile {
  if (isBuiltinPreset(stored.id) && stored.builtin) {
    const meta = BUILTIN_PROFILE_META[stored.id]
    return { ...stored, shortLabel: meta.shortLabel, description: meta.description, risk: meta.risk }
  }
  const meta = BUILTIN_PROFILE_META[stored.base]
  return { ...stored, shortLabel: stored.label, description: stored.hint || meta.description, risk: meta.risk }
}

export function builtinProfile(id: BuiltinPermissionPreset): PermissionProfile {
  const meta = BUILTIN_PROFILE_META[id]
  return {
    id, label: meta.label, hint: meta.hint, base: id, builtin: true, overrides: {},
    position: BUILTIN_PRESET_IDS.indexOf(id),
    shortLabel: meta.shortLabel, description: meta.description, risk: meta.risk
  }
}

/**
 * 落库行与内置档合并成完整档位列表。
 * 内置三档永远存在且排在前面（库里没有对应行就用出厂值），自定义档按 position 跟在后面。
 */
export function mergeProfiles(stored: readonly StoredPermissionProfile[]): PermissionProfile[] {
  const byId = new Map(stored.map((row) => [row.id, row]))
  const builtins = BUILTIN_PRESET_IDS.map((id) => {
    const row = byId.get(id)
    if (!row) return builtinProfile(id)
    // 内置档的 base 与 builtin 标记不接受改写：base 一旦被改，出厂规则就找不回来了。
    return decorate({ ...row, base: id, builtin: true, position: BUILTIN_PRESET_IDS.indexOf(id) })
  })
  const customs = stored
    .filter((row) => !isBuiltinPreset(row.id))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((row) => decorate({ ...row, builtin: false }))
  return [...builtins, ...customs]
}

/** 找不到时回落到受控档：档位被删除后，历史会话里存的旧 id 不能让运行时 fail 掉。 */
export function findProfile(profiles: readonly PermissionProfile[], id: string | null): PermissionProfile {
  return profiles.find((profile) => profile.id === id) ?? profiles[0] ?? builtinProfile('ask')
}

const PROFILE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function slugifyProfileId(label: string): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || `mode-${Date.now().toString(36)}`
}

export interface ProfileDraft {
  id: string
  label: string
  hint: string
  base: BuiltinPermissionPreset
}

/** 返回错误消息，null 表示通过。 */
export function validateProfileDraft(draft: ProfileDraft, existing: readonly PermissionProfile[]): string | null {
  const label = draft.label.trim()
  if (!label) return '档位名称不能为空'
  if (label.length > 24) return '档位名称不能超过 24 个字符'
  if (draft.hint.length > 120) return '档位说明不能超过 120 个字符'
  if (!PROFILE_ID.test(draft.id)) return '档位标识必须使用小写字母、数字和单个连字符'
  if (isBuiltinPreset(draft.id)) return `${draft.id} 是内置档位标识，请换一个`
  if (existing.some((profile) => profile.id === draft.id)) return `档位标识已存在：${draft.id}`
  if (existing.some((profile) => profile.label.trim() === label)) return `档位名称已存在：${label}`
  return null
}

/** 把某个 toolKey 的规则实体化进 overrides；首次编辑时要先从 base 档拷一份出来。 */
function materialize(profile: Pick<StoredPermissionProfile, 'base' | 'overrides'>, toolKey: string): PermissionRule[] {
  const current = profile.overrides[toolKey]
  if (current) return [...current]
  return [...(presetRuleSet(profile.base)[toolKey] ?? [])]
}

export function upsertProfileRule(
  profile: Pick<StoredPermissionProfile, 'base' | 'overrides'>,
  toolKey: string,
  rule: PermissionRule,
  index?: number
): PermissionRuleSet {
  const rules = materialize(profile, toolKey)
  if (index !== undefined && index >= 0 && index < rules.length) rules[index] = rule
  else rules.push(rule)
  return { ...profile.overrides, [toolKey]: rules }
}

export function removeProfileRule(
  profile: Pick<StoredPermissionProfile, 'base' | 'overrides'>,
  toolKey: string,
  index: number
): PermissionRuleSet {
  const rules = materialize(profile, toolKey)
  if (index < 0 || index >= rules.length) return profile.overrides
  rules.splice(index, 1)
  return { ...profile.overrides, [toolKey]: rules }
}

/** 丢掉某个 toolKey 的覆盖，回到 base 档出厂规则。 */
export function resetProfileToolKey(profile: Pick<StoredPermissionProfile, 'overrides'>, toolKey: string): PermissionRuleSet {
  const next = { ...profile.overrides }
  delete next[toolKey]
  return next
}

const ACTIONS: PermissionAction[] = ['allow', 'ask', 'deny']

/** 从库里/IPC 收到的任意 JSON 收敛成合法 PermissionRuleSet，坏数据直接丢弃而不是让运行时崩。 */
export function sanitizeOverrides(input: unknown): PermissionRuleSet {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const result: PermissionRuleSet = {}
  for (const [toolKey, value] of Object.entries(input as Record<string, unknown>)) {
    if (!toolKey || !Array.isArray(value)) continue
    const rules = value.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const { pattern, action } = item as { pattern?: unknown; action?: unknown }
      if (typeof pattern !== 'string' || !pattern) return []
      if (typeof action !== 'string' || !ACTIONS.includes(action as PermissionAction)) return []
      return [{ pattern, action: action as PermissionAction }]
    })
    result[toolKey] = rules
  }
  return result
}
