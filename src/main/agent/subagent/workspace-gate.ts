/**
 * 子代理之间、子代理与主 Agent 写操作之间的工作区协调。
 *
 * 可写子代理曾经整体独占：五个各写一个文件的任务也只能一个跑完再跑下一个。现在改成与
 * Claude Code / Codex 一致的「默认并行」，冲突只在真正碰到同一个文件时处理：
 *
 * - 可写子代理并行进入，只等同一批里已登记的主 Agent 写操作做完——Pi 并行模式先依次跑完
 *   全部 tool_call 钩子才开始执行，主 Agent 的写类 / 命令工具在钩子里只「登记」不等待，
 *   钩子里等锁会让同批两个 edit 互相等死。
 * - 按文件认领：某个文件第一次被一个子代理写入时归它所有，其他子代理再写同一文件直接被拒绝，
 *   而不是排队——排到时拿的已经是别人改过的内容，照旧写回就会静默覆盖对方的改动。
 * - 认领一直保留到所有可写子代理都结束：先结束的子代理一释放，还在跑的子代理可能拿着它读到的
 *   旧内容写回去。
 * - shell 命令只认得出静态重定向目标（`> file`、`tee file`），其余副作用由委派方按提示词
 *   自行拆开，这与 Claude Code 的做法一致。
 */
export interface WriteTarget {
  /** 工作区内的相对路径，用于提示。 */
  path: string
  absolutePath: string
}

export interface WriteClaimConflict {
  path: string
  ownerLabel: string
}

export class WorkspaceGate {
  private activeWriters = 0
  private readonly mainWrites = new Set<string>()
  private readonly waiters: Array<() => void> = []
  private readonly claims = new Map<string, { owner: string; label: string }>()

  /** 主 Agent 的写操作开始（已获批准、即将执行）。 */
  markMainWrite(toolCallId: string) {
    this.mainWrites.add(toolCallId)
  }

  /** 主 Agent 的写操作结束；重复释放无副作用。 */
  releaseMainWrite(toolCallId: string) {
    if (this.mainWrites.delete(toolCallId) && this.mainWrites.size === 0) {
      for (const wake of this.waiters.splice(0)) wake()
    }
  }

  /** 运行一个可写子代理：与其他子代理并行，只等同批主 Agent 写操作结束。 */
  async runWriter<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.waitMainWrites(signal)
    this.activeWriters += 1
    try {
      return await fn()
    } finally {
      this.activeWriters -= 1
      if (this.activeWriters === 0) this.claims.clear()
    }
  }

  /**
   * 认领一批写入目标：全部可认领才一起认领，否则一个都不认领并返回冲突。
   * owner 相同的认领可以重入——同一子代理反复改自己的文件，链式任务接着改前序的文件。
   */
  claimFiles(owner: string, label: string, targets: WriteTarget[]): WriteClaimConflict | null {
    for (const target of targets) {
      const held = this.claims.get(claimKey(target.absolutePath))
      if (held && held.owner !== owner) return { path: target.path, ownerLabel: held.label }
    }
    for (const target of targets) this.claims.set(claimKey(target.absolutePath), { owner, label })
    return null
  }

  private waitMainWrites(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError())
    if (this.mainWrites.size === 0) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const wake = () => { signal?.removeEventListener('abort', onAbort); resolve() }
      const onAbort = () => {
        const index = this.waiters.indexOf(wake)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(abortError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.push(wake)
    })
  }
}

/** Windows 文件系统不区分大小写，同一文件换个大小写写法不能绕过认领。 */
function claimKey(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function abortError(): Error {
  const error = new Error('已取消')
  error.name = 'AbortError'
  return error
}
