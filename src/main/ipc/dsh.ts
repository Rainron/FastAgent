import type { DshService } from '../dsh/service'
import type { IpcRegistrar } from '../app-context'

/** 与 hub 同样的理由：IPC 没有取消通道，给每次调用一个上限，别让挂死的 registry 占住 handler。 */
const CALL_TIMEOUT_MS = 120_000

function callSignal() {
  return AbortSignal.timeout(CALL_TIMEOUT_MS)
}

export function registerDshIpc(handle: IpcRegistrar, dsh: () => DshService) {
  handle('dsh:list', () => dsh().list())
  handle('dsh:state', () => dsh().state())
  handle('dsh:search', (_event, keyword: string) => dsh().search(keyword, callSignal()))
  handle('dsh:install', (_event, name: string, range?: string) => dsh().install(name, range || 'latest', callSignal()))
  handle('dsh:uninstall', (_event, name: string) => dsh().uninstall(name))
  handle('dsh:set-enabled', (_event, name: string, enabled: boolean) => dsh().setEnabled(name, enabled))
  handle('dsh:configure', (_event, name: string, config: Record<string, unknown>) => dsh().configure(name, config ?? {}))
  handle('dsh:remount', () => dsh().remount())
}
