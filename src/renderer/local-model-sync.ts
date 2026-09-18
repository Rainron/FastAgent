import type { FastAgentApi, LocalModelSummary } from '../shared/types'

export function subscribeLocalModels(
  api: Pick<FastAgentApi['models'], 'localList' | 'onChanged'>,
  receive: (models: LocalModelSummary[]) => void,
  failed: (error: unknown) => void
) {
  let disposed = false
  let revision = 0
  let markReady!: () => void
  const ready = new Promise<void>((resolve) => { markReady = resolve })
  const refresh = async () => {
    const current = ++revision
    try {
      const models = await api.localList()
      if (!disposed && current === revision) receive(models)
    } catch (error) {
      if (!disposed && current === revision) failed(error)
    } finally {
      if (!disposed && current === revision) markReady()
    }
  }
  const off = api.onChanged(() => { void refresh() })
  void refresh()
  return { ready, dispose: () => { disposed = true; markReady(); off() } }
}
