export interface RunResourceKey {
  conversationId: string
  provider: string
  modelId: number
}

interface Queued<T> {
  key: RunResourceKey
  task: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  cancelled: boolean
}

export interface ScheduledRun<T> {
  promise: Promise<T>
  cancel: () => void
}

export class RunScheduler {
  private readonly queue: Queued<unknown>[] = []
  private readonly activeConversations = new Set<string>()
  private readonly activeProviders = new Map<string, number>()
  private readonly activeModels = new Map<string, number>()
  private active = 0
  private readonly maxConcurrent: number
  private readonly providerLimits: Record<string, number>
  private readonly modelLimits: Record<string, number>

  constructor(options: { maxConcurrent?: number; providerLimits?: Record<string, number>; modelLimits?: Record<string, number> } = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 4)
    this.providerLimits = options.providerLimits ?? {}
    this.modelLimits = options.modelLimits ?? {}
  }

  schedule<T>(key: RunResourceKey, task: () => Promise<T>): ScheduledRun<T> {
    let entry!: Queued<T>
    const promise = new Promise<T>((resolve, reject) => {
      entry = { key, task, resolve, reject, cancelled: false }
      this.queue.push(entry as Queued<unknown>)
      this.pump()
    })
    return {
      promise,
      cancel: () => {
        if (entry.cancelled) return
        entry.cancelled = true
        const index = this.queue.indexOf(entry as Queued<unknown>)
        if (index >= 0) {
          this.queue.splice(index, 1)
          entry.reject(new DOMException('已取消', 'AbortError'))
        }
      }
    }
  }

  private pump() {
    while (this.active < this.maxConcurrent) {
      const index = this.queue.findIndex((entry) => !entry.cancelled && this.canStart(entry.key))
      if (index < 0) return
      const entry = this.queue.splice(index, 1)[0]
      this.start(entry)
    }
  }

  private canStart(key: RunResourceKey) {
    if (this.activeConversations.has(key.conversationId)) return false
    const modelKey = `${key.provider}:${key.modelId}`
    return (this.activeProviders.get(key.provider) ?? 0) < (this.providerLimits[key.provider] ?? this.maxConcurrent)
      && (this.activeModels.get(modelKey) ?? 0) < (this.modelLimits[modelKey] ?? this.maxConcurrent)
  }

  private start<T>(entry: Queued<T>) {
    const modelKey = `${entry.key.provider}:${entry.key.modelId}`
    this.active += 1
    this.activeConversations.add(entry.key.conversationId)
    this.activeProviders.set(entry.key.provider, (this.activeProviders.get(entry.key.provider) ?? 0) + 1)
    this.activeModels.set(modelKey, (this.activeModels.get(modelKey) ?? 0) + 1)
    void entry.task().then(entry.resolve, entry.reject).finally(() => {
      this.active -= 1
      this.activeConversations.delete(entry.key.conversationId)
      this.activeProviders.set(entry.key.provider, (this.activeProviders.get(entry.key.provider) ?? 1) - 1)
      this.activeModels.set(modelKey, (this.activeModels.get(modelKey) ?? 1) - 1)
      this.pump()
    })
  }
}
