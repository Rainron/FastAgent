/**
 * 事件面包屑：固定容量的环形缓冲。
 *
 * 崩溃报告里真正有用的不是堆栈本身——是「崩之前这个进程在干什么」。
 * 常驻内存、只留最近 N 条，长期运行不会把内存吃掉。
 */
export interface Breadcrumb {
  at: string
  scope: string
  message: string
}

export interface BreadcrumbTrail {
  add(scope: string, message: string): void
  /** 按时间正序返回，最旧在前。 */
  snapshot(): Breadcrumb[]
}

export const DEFAULT_BREADCRUMB_CAPACITY = 200

export function createBreadcrumbTrail(capacity = DEFAULT_BREADCRUMB_CAPACITY, now: () => Date = () => new Date()): BreadcrumbTrail {
  const size = Math.max(0, Math.floor(capacity))
  const buffer: Breadcrumb[] = []
  let next = 0
  let filled = false

  return {
    add(scope: string, message: string) {
      if (size === 0) return
      buffer[next] = { at: now().toISOString(), scope, message }
      next = (next + 1) % size
      if (next === 0) filled = true
    },
    snapshot() {
      if (!filled) return buffer.slice(0, next)
      // 写入位置就是最旧的一条，从那里绕一圈才是时间正序。
      return [...buffer.slice(next), ...buffer.slice(0, next)]
    }
  }
}
