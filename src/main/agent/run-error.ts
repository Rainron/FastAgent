import { isSandboxError } from './sandbox/sandbox-errors'
import type { RunErrorKind } from '../../shared/types'

export interface RunErrorClass {
  kind: RunErrorKind
  /** 是否允许运行时自动重试。permission / sandbox / validation / cancelled 恒为 false。 */
  retryable: boolean
  /** 建议退避毫秒；null 表示不退避（不重试或立即重试）。 */
  backoffMs: number | null
  /** 面向用户的一句话，已剥离栈与 IPC 包装。 */
  message: string
}

/** 指数退避上限。再长用户就该自己重试了，挂着不动比报错更难判断。 */
const MAX_BACKOFF_MS = 30_000
const TIMEOUT_BACKOFF_MS = 2_000

/**
 * 判定全靠消息文本匹配。这不理想，但 pi 与各 provider 的错误目前没有统一的结构化类型，
 * 模式集中在这里，将来拿到结构化错误只改这一处。
 */
const PATTERNS: Array<{ kind: RunErrorKind; test: RegExp }> = [
  // 限流单独一条：与其他网络错误同属 network，但值得优先命中以便日后区分退避曲线
  { kind: 'network', test: /\b429\b|rate[ _-]?limit|too many requests/i },
  { kind: 'network', test: /\b5\d{2}\b|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network error/i },
  { kind: 'timeout', test: /\btimed?[ _-]?out\b|\btimeout\b|超时/i },
  { kind: 'validation', test: /invalid[ _-]?(request|parameter|argument|schema)|schema validation|参数(错误|不合法)/i },
  { kind: 'model', test: /模型响应异常|模型请求失败|模型响应意外结束|无法创建所选模型|未选择可用模型/ }
]

/** tool-runtime 拒绝执行时写进结果的几种理由，全部不该自动重试。 */
const PERMISSION_PATTERN = /权限规则禁止执行|用户拒绝了该操作|操作未获批准|计划模式禁止写入操作/

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return String(error ?? '')
}

function backoffFor(kind: RunErrorKind, attempt: number): number | null {
  if (kind === 'timeout') return TIMEOUT_BACKOFF_MS
  if (kind !== 'network') return null
  return Math.min(1_000 * 2 ** Math.max(0, attempt), MAX_BACKOFF_MS)
}

/**
 * 把任意运行期异常归类。attempt 是已重试次数（0 表示首次失败），只影响退避时长。
 *
 * 判定顺序即优先级：取消与沙箱先于一切，权限先于文本模式匹配——
 * 权限拒绝的消息里常带工具名与路径，容易被后面的模式误命中。
 */
export function classifyRunError(error: unknown, attempt = 0): RunErrorClass {
  const message = messageOf(error)

  if (error instanceof DOMException && error.name === 'AbortError') {
    return { kind: 'cancelled', retryable: false, backoffMs: null, message: message || '已取消' }
  }
  // 渲染进程/IPC 往返后 DOMException 的原型会丢，只能按名字兜一层
  if (error instanceof Error && error.name === 'AbortError') {
    return { kind: 'cancelled', retryable: false, backoffMs: null, message: message || '已取消' }
  }
  if (isSandboxError(error)) {
    // 沙箱违规立即停止相关操作，重试只会再撞一次同样的边界
    return { kind: 'sandbox', retryable: false, backoffMs: null, message }
  }
  if (PERMISSION_PATTERN.test(message)) {
    return { kind: 'permission', retryable: false, backoffMs: null, message }
  }

  for (const pattern of PATTERNS) {
    if (!pattern.test.test(message)) continue
    const retryable = pattern.kind === 'network' || pattern.kind === 'timeout' || pattern.kind === 'model'
    return { kind: pattern.kind, retryable, backoffMs: retryable ? backoffFor(pattern.kind, attempt) : null, message }
  }

  return { kind: 'system', retryable: false, backoffMs: null, message: message || '运行失败' }
}
