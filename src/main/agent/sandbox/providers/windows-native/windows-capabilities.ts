import { compareVersions } from '../../../../plugins/semver'
import type { SandboxCapabilities } from '../../sandbox-types'

/** setup.exe 写入 ProgramData 的初始化记录。 */
export interface SandboxSetupRecord {
  version: string
  offlineSid: string
  onlineSid: string
  createdAt: string
}

export interface CapabilityInput {
  platform: string
  /** runner 可执行文件是否存在 */
  runnerPresent: boolean
  runnerVersion: string | null
  setup: SandboxSetupRecord | null
  /** 凭据文件是否存在且可读 */
  credentialsPresent: boolean
  now: number
}

/** 应用要求的最低 setup / runner 版本；原生程序升级时同步抬高。 */
export const REQUIRED_SANDBOX_VERSION = '0.1.0'

export function evaluateCapabilities(input: CapabilityInput): SandboxCapabilities {
  const base = {
    runnerVersion: input.runnerVersion,
    setupVersion: input.setup?.version ?? null,
    accounts: { offline: Boolean(input.setup?.offlineSid), online: Boolean(input.setup?.onlineSid) },
    checkedAt: input.now
  }
  if (input.platform !== 'win32') return { ...base, status: 'unsupported', reason: 'unsupported' }
  if (!input.runnerPresent) return { ...base, status: 'not_initialized', reason: 'not_initialized' }
  if (!input.setup) return { ...base, status: 'not_initialized', reason: 'not_initialized' }
  if (!base.accounts.offline || !base.accounts.online || !input.credentialsPresent) {
    return { ...base, status: 'broken', reason: 'broken' }
  }
  const runnerVersion = input.runnerVersion
  if (!runnerVersion) return { ...base, status: 'broken', reason: 'broken' }
  if (compareVersions(runnerVersion, REQUIRED_SANDBOX_VERSION) < 0 || compareVersions(input.setup.version, REQUIRED_SANDBOX_VERSION) < 0) {
    return { ...base, status: 'outdated', reason: 'outdated' }
  }
  return { ...base, status: 'ready', reason: null }
}
