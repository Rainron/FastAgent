import type { AbilitySource, LocalCliTool, LocalMcpServerInput } from './abilities'

/** 导出时密钥的处理档位。默认 omit：产物里不出现任何密钥值。 */
export type BundleSecretMode = 'omit' | 'plain' | 'encrypted'

export interface BundleEntryMeta {
  source: AbilitySource
  sourceId?: string
  pluginId?: string
  version?: string
}

export interface BundleSkill {
  name: string
  enabled: boolean
  /** 相对 skill 目录的「路径 -> 文本」 */
  files: Record<string, string>
  meta?: BundleEntryMeta
}

export interface BundleMcp {
  server: LocalMcpServerInput
  disabledTools: string[]
  meta?: BundleEntryMeta
}

export interface BundleCli {
  tool: LocalCliTool
  meta?: BundleEntryMeta
}

export interface BundleContents {
  exportedAt: string
  appVersion?: string
  secrets: BundleSecretMode
  skills: BundleSkill[]
  mcpServers: BundleMcp[]
  cliTools: BundleCli[]
}

export interface BundleExportOptions {
  /** 不传表示全选 */
  skillNames?: string[]
  mcpIds?: string[]
  cliIds?: string[]
  secrets: BundleSecretMode
  passphrase?: string
}

/** 导入时用户逐条勾选的结果。 */
export interface BundleImportPlan {
  skillNames: string[]
  mcpIds: string[]
  cliIds: string[]
  onConflict: 'overwrite' | 'save-as'
  passphrase?: string
}

export interface BundlePreview {
  path: string
  needsPassphrase: boolean
  contents: BundleContents | null
}
