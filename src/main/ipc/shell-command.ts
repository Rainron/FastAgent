import type { ShellCommandRequest } from '../../shared/types'
import { executeShellCommand } from '../run/shell-command'
import { cancelShellCommand } from '../shell-command'
import type { IpcRegistrar, MainContext } from '../app-context'

export function registerShellCommandIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('shell:run-command', (event, input: ShellCommandRequest & { conversationId?: string | null }) => {
    if (!input || typeof input.id !== 'string' || !input.id.trim() || typeof input.command !== 'string' || !input.command.trim()
      || (input.conversationId != null && (typeof input.conversationId !== 'string' || !input.conversationId.trim()))) {
      throw new Error('命令请求无效')
    }
    return executeShellCommand(ctx, input, event.sender)
  })
  handle('shell:cancel-command', (_event, id: string) => typeof id === 'string' && cancelShellCommand(id))
}
