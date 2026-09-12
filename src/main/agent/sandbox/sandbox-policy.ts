import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { resolveSandboxPolicy, type SandboxPolicy, type SandboxSettings } from '../../../shared/sandbox'

/** 主进程侧策略入口：补上真实主目录并规范化工作区路径。 */
export function buildSandboxPolicy(settings: SandboxSettings, workspacePath: string | null, home = homedir()): SandboxPolicy {
  return resolveSandboxPolicy(settings, {
    workspacePath: workspacePath ? resolve(workspacePath) : null,
    home
  })
}
