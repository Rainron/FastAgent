/**
 * 输入框撤销/重做历史：React 受控 textarea 的原生 undo 栈会被程序化改值
 * （引用插入、提及替换、发送清空）打断，这里自建快照栈。
 * 连续打字按时间窗合并成一个撤销点；程序化改值强制独立成点。
 */

export interface ComposerSnapshot {
  value: string
  caret: number
}

export interface ComposerHistory {
  /** 记录一次变更前的快照；force 表示程序化改值，不与相邻打字合并 */
  record(snapshot: ComposerSnapshot, now?: number, force?: boolean): void
  undo(current: ComposerSnapshot): ComposerSnapshot | null
  redo(current: ComposerSnapshot): ComposerSnapshot | null
  canUndo(): boolean
  canRedo(): boolean
}

export function createComposerHistory(options?: { coalesceMs?: number; limit?: number }): ComposerHistory {
  const coalesceMs = options?.coalesceMs ?? 500
  const limit = options?.limit ?? 200
  const past: ComposerSnapshot[] = []
  const future: ComposerSnapshot[] = []
  let lastRecordAt = 0

  return {
    record(snapshot, now = Date.now(), force = false) {
      // 撤销后产生新分支：清掉 redo 尾巴
      future.length = 0
      const shouldMerge = !force && past.length > 0 && now - lastRecordAt < coalesceMs
      if (!shouldMerge) {
        past.push(snapshot)
        if (past.length > limit) past.shift()
        lastRecordAt = now
      }
    },
    undo(current) {
      // 跳过与当前内容相同的重复快照，避免连续 Ctrl+Z 停在同一状态
      while (past.length > 0 && past[past.length - 1].value === current.value) past.pop()
      if (past.length === 0) return null
      const target = past.pop() as ComposerSnapshot
      future.push(current)
      return target
    },
    redo(current) {
      while (future.length > 0 && future[future.length - 1].value === current.value) future.pop()
      if (future.length === 0) return null
      const target = future.pop() as ComposerSnapshot
      past.push(current)
      return target
    },
    canUndo() {
      return past.length > 0
    },
    canRedo() {
      return future.length > 0
    }
  }
}
