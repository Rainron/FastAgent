import type { HubQuery, HubSourceInput } from '../../shared/types'
import type { createHubService } from '../hub/hub-service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IpcRegistrar = (channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) => void

/** IPC 调用没有取消通道，给每次调用一个上限，避免一个挂死的源把 handler 永久占住。 */
const CALL_TIMEOUT_MS = 60_000

function callSignal() {
  return AbortSignal.timeout(CALL_TIMEOUT_MS)
}

export function registerHubIpc(handle: IpcRegistrar, hub: ReturnType<typeof createHubService>) {
  handle('hub:sources', () => hub.sources())
  handle('hub:save-source', (_event, input: HubSourceInput) => hub.saveSource(input))
  handle('hub:remove-source', (_event, id: string) => hub.removeSource(id))
  handle('hub:test-source', (_event, id: string) => hub.testSource(id, callSignal()))
  handle('hub:search', (_event, query: HubQuery) => hub.search(query ?? {}, callSignal()))
  handle('hub:detail', (_event, sourceId: string, ref: string) => hub.detail(sourceId, ref, callSignal()))
  handle('hub:install', (_event, sourceId: string, ref: string, config?: Record<string, string>) =>
    hub.install(sourceId, ref, config ?? {}, callSignal()))
  handle('hub:categories', () => hub.categories(callSignal()))
  handle('hub:check-updates', () => hub.checkUpdates(callSignal()))
}
