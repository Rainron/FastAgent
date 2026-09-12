/**
 * 日志门面：持有目录、写入器与面包屑，供主进程各处调用。
 *
 * 分三类落盘，互不混淆：
 *   crash-*.log         崩溃，一次一份，带完整上下文
 *   error-<日期>.log     应用自身的错误
 *   integration-<日期>.log  外部服务（后端 / 模型 / MCP）的错误
 * 分开是为了排查时能一眼看出「是我们的错还是对方的错」。
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createBreadcrumbTrail, type Breadcrumb, type BreadcrumbTrail } from './breadcrumbs'
import { createDailyLogWriter, type DailyLogWriter } from './daily-log'
import { crashFileName, formatCrashReport, type CrashContext } from './crash-report'
import { resolveLogDir, type LogDirOptions, type LogLocation } from './log-paths'

const KEEP_DAYS = 14
const KEEP_CRASH_REPORTS = 20

let location: LogLocation | null = null
let errorWriter: DailyLogWriter | null = null
let integrationWriter: DailyLogWriter | null = null
const trail: BreadcrumbTrail = createBreadcrumbTrail()

export type { CrashContext, CrashKind } from './crash-report'
export type { Breadcrumb } from './breadcrumbs'

export function initLogging(options: LogDirOptions): LogLocation {
  location = resolveLogDir(options)
  errorWriter = createDailyLogWriter({ dir: location.dir, prefix: 'error', keepDays: KEEP_DAYS })
  integrationWriter = createDailyLogWriter({ dir: location.dir, prefix: 'integration', keepDays: KEEP_DAYS })
  breadcrumb('logging', `日志目录 ${location.dir}${location.fallback ? '（回落）' : ''}`)
  return location
}

export function currentLogLocation(): LogLocation | null {
  return location
}

export function breadcrumb(scope: string, message: string): void {
  trail.add(scope, message)
}

export function breadcrumbSnapshot(): Breadcrumb[] {
  return trail.snapshot()
}

function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) return { message: error.message, stack: error.stack ?? null }
  return { message: String(error), stack: null }
}

function stamp() {
  return new Date().toISOString()
}

/** 应用自身的错误：IPC 处理失败、本地库、文件、权限等。 */
export function logAppError(scope: string, error: unknown, extra?: Record<string, unknown>): void {
  const { message, stack } = describeError(error)
  const tail = extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : ''
  breadcrumb('error', `${scope}: ${message}`)
  errorWriter?.append(`[${stamp()}] ${scope}: ${message}${tail}${stack ? `\n${stack}` : ''}`)
}

export interface IntegrationErrorInput {
  service: 'backend' | 'model' | 'mcp'
  /** 具体端点：URL path、模型名或 MCP server id。 */
  endpoint: string
  message: string
  status?: number
  durationMs?: number
}

/**
 * 外部服务错误。
 * 调用方必须先把消息脱敏（见 secret-redaction），这里不记录请求体与响应体——
 * 登录接口的 body 里有密码，模型请求头里有 api_key。
 */
export function logIntegrationError(input: IntegrationErrorInput): void {
  const parts = [
    `[${stamp()}]`,
    `[${input.service}]`,
    input.endpoint,
    input.status === undefined ? null : `status=${input.status}`,
    input.durationMs === undefined ? null : `${input.durationMs}ms`,
    `- ${input.message}`
  ].filter((part): part is string => part !== null)
  breadcrumb('integration', `${input.service} ${input.endpoint}${input.status === undefined ? '' : ` ${input.status}`}`)
  integrationWriter?.append(parts.join(' '))
}

/** 只保留最近若干份崩溃报告，避免反复崩溃把目录塞满。 */
function pruneCrashReports(dir: string) {
  const files = readdirSync(dir).filter((name) => name.startsWith('crash-') && name.endsWith('.log')).sort().reverse()
  for (const name of files.slice(KEEP_CRASH_REPORTS)) rmSync(join(dir, name), { force: true })
}

/**
 * 写崩溃报告。返回文件路径，写不出去返回 null。
 * 全同步：调用点上进程随时可能没，异步写等于没写。
 */
export function writeCrashReport(context: Omit<CrashContext, 'logLocation' | 'breadcrumbs'>): string | null {
  const dir = location?.dir
  if (!dir) return null
  const report = formatCrashReport({ ...context, logLocation: location, breadcrumbs: trail.snapshot() })
  const path = join(dir, crashFileName(context.kind, context.at))
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, report, 'utf8')
  } catch (error) {
    // 崩溃报告写不出去时至少让控制台留下内容，不能再抛错盖掉原始崩溃。
    console.error('[logging] 崩溃报告写入失败:', error)
    console.error(report)
    return null
  }
  try {
    pruneCrashReports(dir)
  } catch {
    // 裁剪失败不影响本次报告已经落盘。
  }
  return path
}
