import { useEffect, useMemo, useRef, useState } from 'react'
import { motionEnabled } from './motion'
import { useDelayedUnmount } from './use-delayed-unmount'

/**
 * 条件渲染的退场版本，带「最后一份内容」：value 变成 null 之后再保留 duration 毫秒，
 * 这段时间里 item 仍是关闭前那份值（面板的数据、附件、选中的子代理），调用方挂 closing 播退场。
 *
 * suppressExit：同一个位置马上有别的东西顶上（右侧从一个面板切到另一个）时不播退场、直接卸载，
 * 否则新旧两个面板会并排挤在右侧一瞬。一旦在退场中被压下，本次退场就不再恢复。
 */
export function usePresence<T>(value: T | null, duration: number, suppressExit = false): { item: T | null; closing: boolean } {
  const last = useRef<T | null>(value)
  const suppressed = useRef(false)
  if (value !== null) {
    last.current = value
    suppressed.current = false
  }
  const mounted = useDelayedUnmount(value !== null, duration)
  const closing = value === null && mounted
  if (closing && suppressExit) suppressed.current = true
  if (!mounted || (closing && suppressed.current)) return { item: null, closing: false }
  return { item: last.current, closing }
}

/**
 * 列表版的退场：从 items 里消失的项再保留 duration 毫秒（exiting=true），按原来的顺序留在原位。
 * 用于审批弹窗这类「答复后从队列里移走」的条目。动效关闭时不保留。
 */
export function useExitingItems<T>(items: T[], keyOf: (item: T) => string, duration: number, resetKey: unknown = null): Array<{ item: T; exiting: boolean }> {
  const previous = useRef(items)
  // resetKey 变了（切会话）说明整份列表换了一批，不是答复后移走，不播退场
  const lastReset = useRef(resetKey)
  const leaving = useRef<{ id: number; items: T[]; order: string[] } | null>(null)
  const [cleared, setCleared] = useState(0)
  const rendered = useMemo(() => {
    const before = previous.current
    if (before !== items) {
      const present = new Set(items.map(keyOf))
      const sameScope = lastReset.current === resetKey
      lastReset.current = resetKey
      if (!sameScope) leaving.current = null
      const removed = motionEnabled() && sameScope ? before.filter((item) => !present.has(keyOf(item))) : []
      if (removed.length) leaving.current = { id: (leaving.current?.id ?? 0) + 1, items: [...(leaving.current?.items ?? []), ...removed], order: before.map(keyOf) }
      previous.current = items
    }
    const gone = leaving.current
    if (!gone) return items.map((item) => ({ item, exiting: false }))
    const live = new Map(items.map((item) => [keyOf(item), item]))
    const exitingByKey = new Map(gone.items.map((item) => [keyOf(item), item]))
    const placed = new Set<string>()
    const result: Array<{ item: T; exiting: boolean }> = []
    for (const key of gone.order) {
      const current = live.get(key)
      if (current !== undefined) { result.push({ item: current, exiting: false }); placed.add(key); continue }
      const old = exitingByKey.get(key)
      if (old !== undefined) { result.push({ item: old, exiting: true }); placed.add(key) }
    }
    for (const item of items) if (!placed.has(keyOf(item))) result.push({ item, exiting: false })
    return result
  // keyOf 由调用方内联传入，每次渲染都是新引用；cleared 只用来在退场结束后重算一次
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, cleared, resetKey])
  const batch = leaving.current?.id ?? null
  useEffect(() => {
    if (batch === null) return
    const timer = window.setTimeout(() => { leaving.current = null; setCleared((value) => value + 1) }, duration)
    return () => window.clearTimeout(timer)
  }, [batch, duration])
  return rendered
}
