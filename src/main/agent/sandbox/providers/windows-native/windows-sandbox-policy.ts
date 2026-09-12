import { sandboxAccountName, type SandboxPolicy } from '../../../../../shared/sandbox'

/** 传给 runner 的会话参数；runner 据此建立 Restricted Token 与 Job Object。 */
export interface RunnerSessionArgs {
  sessionId: string
  account: string
  workspacePath: string | null
  networkMode: SandboxPolicy['network']['mode']
  shell: 'bash' | 'powershell'
  denyRead: string[]
  denyWrite: string[]
  allowWrite: string[]
  maxProcesses: number
  timeoutMs: number
}

export function buildRunnerSessionArgs(sessionId: string, accountMode: 'offline' | 'online', policy: SandboxPolicy, shell: 'bash' | 'powershell'): RunnerSessionArgs {
  return {
    sessionId,
    account: sandboxAccountName(accountMode),
    workspacePath: policy.filesystem.workspacePath,
    networkMode: policy.network.mode,
    shell,
    denyRead: policy.filesystem.denyRead,
    denyWrite: policy.filesystem.denyWrite,
    allowWrite: policy.filesystem.allowWrite,
    maxProcesses: policy.process.maxProcesses,
    timeoutMs: policy.process.timeoutMs
  }
}

/**
 * 工作区授权参数：目录属主是当前用户，授予沙箱账户读写不需要管理员权限。
 * 工作区之外不授予任何写权限，越权由 Windows 内核拒绝。
 */
export function buildWorkspaceGrantArgs(accountMode: 'offline' | 'online', workspacePath: string) {
  return ['--grant-workspace', workspacePath, '--account', sandboxAccountName(accountMode)]
}

/**
 * 内置工具链授权参数：只给读取与执行。
 * runtime 装在数据根（.fa）下，默认在用户 profile 里，沙箱账户读不到；
 * 不授权的话沙箱内 git/rg/jq 全部不可用。给的是 RX 而不是 M——
 * 那是一份随包分发的二进制，沙箱里的命令没有任何理由改写它。
 */
export function buildRuntimeGrantArgs(accountMode: 'offline' | 'online', runtimePath: string) {
  return ['--grant-runtime', runtimePath, '--account', sandboxAccountName(accountMode)]
}
