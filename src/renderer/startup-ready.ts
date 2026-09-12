/**
 * 首屏就绪竞速：等首屏那几路数据全部落定，或到上限就不再等。
 *
 * 主窗口在这之前是隐藏的，任何一路悬挂都会把窗口一起卡住，所以这里既不能 reject，
 * 也必须有硬上限——宁可让列表后填，也不能让用户对着启动页干等。
 */
export interface ReadyTimer {
  set(handler: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const defaultTimer: ReadyTimer = {
  set: (handler, ms) => setTimeout(handler, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export function whenFirstScreenReady(
  promises: ReadonlyArray<Promise<unknown>>,
  timeoutMs: number,
  timer: ReadyTimer = defaultTimer
): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    let handle: unknown = null
    const finish = () => {
      if (done) return
      done = true
      if (handle !== null) timer.clear(handle)
      resolve()
    }
    handle = timer.set(finish, timeoutMs)
    // allSettled：任一路加载失败都不该拖住窗口显示，失败提示由各自的 catch 负责。
    void Promise.allSettled(promises).then(finish)
  })
}
