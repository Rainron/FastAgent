/**
 * 运行暂停闸门。
 *
 * 能挡住的只有「下一次工具调用」：已经发出的模型请求没有中断通道，
 * 正在执行的工具也不会被打断。界面文案必须与这个边界一致，
 * 不能在按下暂停的瞬间就宣称已经停住——那是提前显示的假状态。
 *
 * 取消优先于暂停：signal 中止时 wait 立刻返回，让调用方继续走既有的取消路径，
 * 否则暂停中的运行会永远卡在闸门上，连取消都点不动。
 */
export class PauseGate {
  private paused = false
  private waiters: Array<() => void> = []

  get isPaused(): boolean {
    return this.paused
  }

  /** 等待中的调用数；用于测试与「暂停已生效」的判定。 */
  get waitingCount(): number {
    return this.waiters.length
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    const pending = this.waiters
    this.waiters = []
    for (const release of pending) release()
  }

  /** 未暂停时同步返回，不制造一次多余的微任务：这是每次工具调用都会走的热路径。 */
  wait(signal?: AbortSignal): Promise<void> | void {
    if (!this.paused || signal?.aborted) return
    return new Promise<void>((resolve) => {
      let settled = false
      const release = () => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = () => {
        this.waiters = this.waiters.filter((item) => item !== release)
        release()
      }
      this.waiters.push(release)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}
