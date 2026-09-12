/**
 * 按天分文件的追加写入器，跨天时顺手裁掉过期文件。
 *
 * 同步写：崩溃路径上进程随时可能没，异步写有丢失风险；错误量本来就低，
 * 这点同步 IO 换的是「日志一定落在磁盘上」。
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export interface DailyLogWriter {
  append(line: string): void
  /** 当前应写入的文件路径，便于把位置回报给界面。 */
  currentPath(): string
}

export interface DailyLogOptions {
  dir: string
  prefix: string
  keepDays: number
  now?: () => Date
}

function dateKey(now: Date) {
  return now.toISOString().slice(0, 10)
}

/** 保留最近 keepDays 份同前缀日志。命名与筛选规则照 backup-service 的 pruneBackups。 */
export function pruneDailyLogs(dir: string, prefix: string, keepDays: number): string[] {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{4}-\\d{2}-\\d{2}\\.log$`)
  const files = readdirSync(dir).filter((name) => pattern.test(name)).sort().reverse()
  const removed: string[] = []
  for (const name of files.slice(Math.max(0, keepDays))) {
    rmSync(join(dir, name), { force: true })
    removed.push(name)
  }
  return removed
}

export function createDailyLogWriter(options: DailyLogOptions): DailyLogWriter {
  const now = options.now ?? (() => new Date())
  let activeKey = ''

  const pathFor = (key: string) => join(options.dir, `${options.prefix}-${key}.log`)

  return {
    append(line: string) {
      // 记日志本身出错绝不能反过来影响主流程，整段吞掉。
      try {
        const key = dateKey(now())
        // 跨天才做目录准备与裁剪，避免每条日志都去读一次目录。
        const rolled = key !== activeKey
        if (rolled) {
          activeKey = key
          mkdirSync(options.dir, { recursive: true })
        }
        appendFileSync(pathFor(key), line.endsWith('\n') ? line : `${line}\n`, 'utf8')
        if (rolled) {
          try {
            // 必须写完再裁：先裁的话当天这份还不存在，保留份数会多出一个。
            pruneDailyLogs(options.dir, options.prefix, options.keepDays)
          } catch {
            // 裁剪失败最坏只是文件多留几份，不值得让这次写入失败。
          }
        }
      } catch (error) {
        console.error(`[logging] 写入 ${options.prefix} 日志失败:`, error)
      }
    },
    currentPath() {
      return pathFor(dateKey(now()))
    }
  }
}
