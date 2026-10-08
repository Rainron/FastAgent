import { MAX_SHELL_COMMAND_OUTPUT, normalizeShellCommandSettings, truncateShellOutput } from '../../shared/shell-command'
import type { ShellCommandChunk, ShellCommandRequest } from '../../shared/types'
import { buildSandboxPolicy } from '../agent/sandbox/sandbox-policy'
import type { MainContext } from '../app-context'
import { cancelShellCommand, runShellCommand } from '../shell-command'

export async function executeShellCommand(ctx: MainContext, input: ShellCommandRequest & { conversationId?: string | null }, sender: Electron.WebContents) {
  const namespace = ctx.requireNamespace()
  const settings = normalizeShellCommandSettings(ctx.settings.shellCommand)
  if (!settings.enabled) throw new Error('已在设置里关闭「! 直接执行命令」')
  if (input.conversationId && !ctx.store.getConversation(namespace, input.conversationId)) throw new Error('会话不存在')
  const workspaceRoot = input.conversationId
    ? ctx.store.getConversationRoot(namespace, input.conversationId) ?? ctx.appPaths.quickWorkspaceDir
    : ctx.workspaceRoot ?? ctx.appPaths.quickWorkspaceDir
  let pendingOutput = ''
  let outputTimer: ReturnType<typeof setTimeout> | null = null
  const flushOutput = () => {
    if (outputTimer !== null) clearTimeout(outputTimer)
    outputTimer = null
    const chunk = pendingOutput
    pendingOutput = ''
    if (chunk && !sender.isDestroyed()) sender.send('shell:command-output', { id: input.id, chunk } satisfies ShellCommandChunk)
  }
  const cancel = () => { cancelShellCommand(input.id) }
  sender.once('destroyed', cancel)
  try {
    if (sender.isDestroyed()) throw new Error('命令窗口已关闭')
    return await runShellCommand(input.id, input.command, {
      shellPreference: ctx.settings.shellPreference,
      bashPath: ctx.settings.bashPath,
      bundledBash: ctx.bundledTools.bash,
      workspaceRoot,
      policy: buildSandboxPolicy(ctx.settings.sandbox, workspaceRoot),
      manager: ctx.sandboxManager,
      timeoutSeconds: settings.timeoutSeconds,
      onData: (chunk) => {
        // 高速打印只保留待发送的尾部，避免 IPC 消息与暂存字符串无限增长。
        pendingOutput = truncateShellOutput(pendingOutput + chunk, MAX_SHELL_COMMAND_OUTPUT).text
        if (outputTimer === null) outputTimer = setTimeout(flushOutput, 16)
      }
    })
  } finally {
    flushOutput()
    sender.removeListener('destroyed', cancel)
  }
}
