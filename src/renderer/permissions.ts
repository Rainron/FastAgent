import type { ConversationMode } from '../shared/types'
import { BUILTIN_PRESET_IDS, BUILTIN_PROFILE_META, type BuiltinPermissionPreset, type PermissionProfile } from '../shared/permission-profiles'

export type PermissionPreset = BuiltinPermissionPreset
export type AccessScope = 'workspace' | 'full'
export type ApprovalPolicy = 'ask-when-needed' | 'high-risk'

/** 档位对外承诺的能力面，用于说明性展示；真正的判定在 permission-rules。 */
export interface PermissionCapabilities {
  accessScope: AccessScope
  approvalPolicy: ApprovalPolicy
  filesystem: { workspace: boolean; outsideWorkspace: boolean; systemDirectories: boolean }
  shell: { runCommands: boolean; installPackages: boolean; systemCommands: boolean }
  network: { internet: boolean; localNetwork: boolean }
  git: { read: boolean; write: boolean; push: boolean }
  mcp: boolean
  browser: boolean
}

export interface PermissionSummary {
  /** 空间宽裕时的完整名称 */
  label: string
  /** 底栏收窄后的缩写 */
  shortLabel: string
  /** 弹层选项里的一行说明 */
  hint: string
  /** 完整说明，用于 tooltip 与二次确认 */
  description: string
  risk: boolean
}

export const permissionPresets: PermissionPreset[] = BUILTIN_PRESET_IDS

export function defaultPermissionForMode(mode: ConversationMode): PermissionPreset | null {
  return mode === 'chat' ? null : 'ask'
}

export function permissionSummary(preset: PermissionPreset): PermissionSummary {
  const meta = BUILTIN_PROFILE_META[preset]
  return { label: meta.label, shortLabel: meta.shortLabel, hint: meta.hint, description: meta.description, risk: meta.risk }
}

/** 自定义档位没有出厂元数据，展示信息直接取档位自身字段。 */
export function profileSummary(profile: PermissionProfile): PermissionSummary {
  return { label: profile.label, shortLabel: profile.shortLabel, hint: profile.hint, description: profile.description, risk: profile.risk }
}

export function permissionProfile(preset: PermissionPreset): PermissionCapabilities {
  if (preset === 'ask') return {
    accessScope: 'workspace', approvalPolicy: 'ask-when-needed',
    filesystem: { workspace: true, outsideWorkspace: false, systemDirectories: false },
    shell: { runCommands: false, installPackages: false, systemCommands: false },
    network: { internet: false, localNetwork: false },
    git: { read: true, write: false, push: false }, mcp: false, browser: false
  }
  if (preset === 'workspace') return {
    accessScope: 'workspace', approvalPolicy: 'high-risk',
    filesystem: { workspace: true, outsideWorkspace: false, systemDirectories: false },
    shell: { runCommands: true, installPackages: false, systemCommands: false },
    network: { internet: false, localNetwork: false },
    git: { read: true, write: true, push: false }, mcp: false, browser: false
  }
  return {
    accessScope: 'full', approvalPolicy: 'high-risk',
    filesystem: { workspace: true, outsideWorkspace: true, systemDirectories: true },
    shell: { runCommands: true, installPackages: true, systemCommands: true },
    network: { internet: true, localNetwork: true },
    git: { read: true, write: true, push: true }, mcp: true, browser: true
  }
}
