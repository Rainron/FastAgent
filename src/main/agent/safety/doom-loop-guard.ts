import { createHash } from 'node:crypto'

/** 排序键的稳定序列化，保证相同入参（键序无关）得到相同 hash。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item) ?? 'null'}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export interface DoomLoopCheckResult {
  hash: string
  /** 连续第 threshold 次重复时触发 */
  triggered: boolean
}

/**
 * 同 hash 连续重复到阈值即触发审批（不是硬阻断）。计数器按实例（run）维度存放；
 * 触发一次后重新计数，已豁免的 hash 不再计数。
 */
export class DoomLoopGuard {
  private readonly counters = new Map<string, number>()
  private readonly exempt = new Set<string>()

  constructor(private readonly threshold = 3) {}

  hash(toolName: string, args: unknown): string {
    return createHash('sha256').update(toolName + canonicalJson(args)).digest('hex')
  }

  exemptHash(hash: string) {
    this.exempt.add(hash)
  }

  check(toolName: string, args: unknown): DoomLoopCheckResult {
    const hash = this.hash(toolName, args)
    if (this.exempt.has(hash)) return { hash, triggered: false }
    const count = (this.counters.get(hash) ?? 0) + 1
    this.counters.set(hash, count)
    if (count >= this.threshold) {
      this.counters.set(hash, 0)
      return { hash, triggered: true }
    }
    return { hash, triggered: false }
  }
}