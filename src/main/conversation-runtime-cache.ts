export interface DisposableConversationRuntime {
  dispose(): void | Promise<void>
}

/** 同一会话共用一个 promise tail；不同会话没有共享锁。 */
export class ConversationRunCoordinator {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(conversationId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(conversationId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    this.tails.set(conversationId, current)
    await previous.catch(() => undefined)
    try {
      return await task()
    } finally {
      release()
      if (this.tails.get(conversationId) === current) this.tails.delete(conversationId)
    }
  }
}

interface CacheEntry<T> {
  signature: string
  value: T
  lastUsedAt: number
  leases: number
  invalidated: boolean
}

export class ConversationRuntimeCache<T extends DisposableConversationRuntime> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private readonly operations = new ConversationRunCoordinator()
  private readonly capacity: number
  private readonly idleMs: number
  private readonly now: () => number

  constructor(options: { capacity?: number; idleMs?: number; now?: () => number } = {}) {
    this.capacity = Math.max(1, options.capacity ?? 8)
    this.idleMs = Math.max(1, options.idleMs ?? 10 * 60 * 1000)
    this.now = options.now ?? Date.now
  }

  get(conversationId: string, signature: string, create: () => Promise<T>): Promise<T> {
    return this.getWithStatus(conversationId, signature, create).then((result) => result.value)
  }

  getWithStatus(conversationId: string, signature: string, create: () => Promise<T>): Promise<{ value: T; cacheHit: boolean }> {
    return this.operations.run(conversationId, async () => {
      const usedAt = this.now()
      await this.pruneEntries(usedAt, conversationId)
      const existing = this.entries.get(conversationId)
      if (existing?.signature === signature) {
        existing.lastUsedAt = usedAt
        return { value: existing.value, cacheHit: true }
      }
      if (existing) {
        this.entries.delete(conversationId)
        existing.invalidated = true
        if (existing.leases === 0) await existing.value.dispose()
      }
      const value = await create()
      this.entries.set(conversationId, { signature, value, lastUsedAt: usedAt, leases: 0, invalidated: false })
      await this.trimToCapacity(conversationId)
      return { value, cacheHit: false }
    })
  }

  invalidate(conversationId: string): Promise<void> {
    return this.operations.run(conversationId, async () => {
      const entry = this.entries.get(conversationId)
      if (!entry) return
      this.entries.delete(conversationId)
      entry.invalidated = true
      if (entry.leases === 0) await entry.value.dispose()
    })
  }

  /** 运行期间固定 runtime，避免容量淘汰或压缩失效销毁活跃 session。 */
  retain(conversationId: string): void {
    const entry = this.entries.get(conversationId)
    if (entry) entry.leases += 1
  }

  async release(conversationId: string): Promise<void> {
    const entry = this.entries.get(conversationId)
    if (!entry) return
    entry.leases = Math.max(0, entry.leases - 1)
    if (entry.invalidated && entry.leases === 0) {
      this.entries.delete(conversationId)
      await entry.value.dispose()
    }
  }

  async prune(): Promise<void> {
    await this.pruneEntries(this.now())
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(entries.map((entry) => entry.value.dispose()))
  }

  private async pruneEntries(now: number, keepConversationId?: string): Promise<void> {
    const expired = [...this.entries.entries()]
      .filter(([conversationId, entry]) => conversationId !== keepConversationId && now - entry.lastUsedAt > this.idleMs)
    for (const [conversationId, entry] of expired) {
      if (this.entries.get(conversationId) !== entry) continue
      this.entries.delete(conversationId)
      entry.invalidated = true
      if (entry.leases === 0) await entry.value.dispose()
    }
  }

  private async trimToCapacity(keepConversationId: string): Promise<void> {
    if (this.entries.size <= this.capacity) return
    const candidates = [...this.entries.entries()]
      .filter(([conversationId]) => conversationId !== keepConversationId)
      .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt)
    while (this.entries.size > this.capacity && candidates.length) {
      const [conversationId, entry] = candidates.shift() as [string, CacheEntry<T>]
      if (this.entries.get(conversationId) !== entry) continue
      this.entries.delete(conversationId)
      entry.invalidated = true
      if (entry.leases === 0) await entry.value.dispose()
    }
  }
}
