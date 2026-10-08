import type { IpcRegistrar, MainContext } from '../app-context'
import { registerAbilitiesIpc } from './abilities'
import { registerAppWindowIpc } from './app-window'
import { registerArtifactsIpc } from './artifacts'
import { registerAuthIpc } from './auth'
import { registerBundleIpc } from './bundle'
import { registerChatIpc } from './chat'
import { registerConversationIpc } from './conversation'
import { registerDiagnosticsIpc } from './diagnostics'
import { registerHubIpc } from './hub'
import { registerKbIpc } from './kb'
import { registerMcpIpc } from './mcp'
import { registerMemoryIpc } from './memory'
import { registerModelIpc } from './model'
import { registerSearchIpc } from './search'
import { registerSettingsIpc } from './settings'
import { registerShellCommandIpc } from './shell-command'
import { registerSkillsIpc } from './skills'
import { registerTerminalIpc } from './terminal'
import { registerWorkspaceIpc } from './workspace'

export type { IpcRegistrar, MainContext } from '../app-context'

/** 按域注册全部 IPC 通道。新增通道加进对应域文件，不要再往这里堆。 */
export function registerAllIpc(handle: IpcRegistrar, ctx: MainContext) {
  registerAuthIpc(handle, ctx)
  registerModelIpc(handle, ctx)
  registerAppWindowIpc(handle, ctx)
  registerSettingsIpc(handle, ctx)
  registerConversationIpc(handle, ctx)
  registerSkillsIpc(handle, ctx)
  registerSearchIpc(handle, ctx)
  registerMcpIpc(handle, ctx)
  registerAbilitiesIpc(handle, ctx)
  registerHubIpc(handle, ctx.hubService)
  registerBundleIpc(handle, { bundles: ctx.bundleService, mainWindow: () => ctx.mainWindow, exportsDir: () => ctx.appPaths.exportsDir })
  registerChatIpc(handle, ctx)
  registerWorkspaceIpc(handle, ctx)
  registerShellCommandIpc(handle, ctx)
  registerTerminalIpc(handle, ctx)
  registerKbIpc(handle, ctx)
  registerArtifactsIpc(handle, ctx)
  registerDiagnosticsIpc(handle, ctx)
  registerMemoryIpc(handle, ctx)
}
