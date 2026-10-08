export interface DisposableConversationRuntime {
  dispose(): void | Promise<void>
}

export interface ConversationRuntimeLease<T extends DisposableConversationRuntime = DisposableConversationRuntime> {
  readonly conversationId: string
  readonly entry: T
  released: boolean
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
  /** 已失效但仍被运行占用的条目：必须等对应租约释放后才能销毁。 */
  private readonly detached = new Map<string, CacheEntry<T>[]>()
  private readonly operations = new ConversationRunCoordinator()
  private readonly capacity: number
  private readonly idleMs: number
  private readonly now: () => number

  /** 从 entries 摘掉一条：没人占用就地销毁，还被占用就转入 detached 等 release。 */
  private async retire(conversationId: string, entry: CacheEntry<T>): Promise<void> {
    this.entries.delete(conversationId)
    entry.invalidated = true
    if (entry.leases === 0) { await entry.value.dispose(); return }
    const list = this.detached.get(conversationId) ?? []
    list.push(entry)
    this.detached.set(conversationId, list)
  }

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
      if (existing) await this.retire(conversationId, existing)
      const value = await create()
      this.entries.set(conversationId, { signature, value, lastUsedAt: usedAt, leases: 0, invalidated: false })
      await this.trimToCapacity(conversationId)
      return { value, cacheHit: false }
    })
  }

  /**
   * 取当前活着的运行时，不创建、不校验 signature、不刷新 lastUsedAt。
   * 手动压缩要优先用活着的那个 session：另开一份去压，缓存里的 agent.state 会与
   * 刚追加了 compaction entry 的 session 文件分叉。
   */
  peek(conversationId: string): T | null {
    return this.entries.get(conversationId)?.value ?? null
  }

  invalidate(conversationId: string): Promise<void> {
    return this.operations.run(conversationId, async () => {
      const entry = this.entries.get(conversationId)
      if (!entry) return
      await this.retire(conversationId, entry)
    })
  }

  /** 运行期间固定 runtime，避免容量淘汰或压缩失效销毁活跃 session。 */
  retain(conversationId: string): ConversationRuntimeLease<T> | null {
    const entry = this.entries.get(conversationId)
    if (!entry) return null
    entry.leases += 1
    return { conversationId, entry: entry.value, released: false }
  }

  async release(lease: ConversationRuntimeLease<T>): Promise<void> {
    if (lease.released) return
    lease.released = true
    const detached = this.detached.get(lease.conversationId)
    const detachedIndex = detached?.findIndex((item) => item.value === lease.entry) ?? -1
    const entry = detachedIndex >= 0 && detached ? detached[detachedIndex] : this.entries.get(lease.conversationId)
    if (!entry || entry.value !== lease.entry) return
    entry.leases = Math.max(0, entry.leases - 1)
    if (entry.invalidated && entry.leases === 0) {
      if (detachedIndex >= 0 && detached) {
        detached.splice(detachedIndex, 1)
        if (!detached.length) this.detached.delete(lease.conversationId)
      } else {
        this.entries.delete(lease.conversationId)
      }
      await entry.value.dispose()
    }
  }

  async prune(): Promise<void> {
    await this.pruneEntries(this.now())
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.entries.values(), ...[...this.detached.values()].flat()]
    this.entries.clear()
    this.detached.clear()
    await Promise.all(entries.map((entry) => entry.value.dispose()))
  }

  private async pruneEntries(now: number, keepConversationId?: string): Promise<void> {
    const expired = [...this.entries.entries()]
      .filter(([conversationId, entry]) => conversationId !== keepConversationId && now - entry.lastUsedAt > this.idleMs)
    for (const [conversationId, entry] of expired) {
      if (this.entries.get(conversationId) !== entry) continue
      await this.retire(conversationId, entry)
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
      await this.retire(conversationId, entry)
    }
  }
}
