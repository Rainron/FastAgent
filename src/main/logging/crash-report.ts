/**
 * 崩溃报告的组装与命名。
 *
 * 纯格式化，不碰文件系统也不读全局状态：崩溃路径上出错的代价太高，
 * 这一层必须能在测试里完整验证。
 */
import type { Breadcrumb } from './breadcrumbs'
import type { LogLocation } from './log-paths'

export type CrashKind =
  | 'main-uncaught'
  | 'main-rejection'
  | 'renderer-gone'
  | 'child-gone'
  | 'unresponsive'
  | 'renderer-error'

export const CRASH_KIND_LABELS: Record<CrashKind, string> = {
  'main-uncaught': '主进程未捕获异常',
  'main-rejection': '主进程未处理的 Promise 拒绝',
  'renderer-gone': '渲染进程退出',
  'child-gone': '子进程退出',
  unresponsive: '窗口无响应',
  'renderer-error': '界面未捕获异常'
}

export interface CrashProcessMetric {
  type: string
  pid: number
  cpuPercent?: number
  workingSetKb?: number
}

export interface CrashRuntimeInfo {
  version: string
  electron: string
  node: string
  chrome: string
  platform: string
  uptimeSeconds: number
  memory?: { rss: number; heapUsed: number; heapTotal: number; external: number }
  processes?: CrashProcessMetric[]
}

export interface CrashContext {
  kind: CrashKind
  at: Date
  /** reason / exitCode / serviceName 之类的补充说明。 */
  detail?: string | null
  error?: { message: string; stack?: string | null; componentStack?: string | null } | null
  logLocation?: LogLocation | null
  runtime?: CrashRuntimeInfo | null
  /** 登录态、工作区、活跃 run 数这类当下状态。 */
  state?: Record<string, string | number | boolean | null | undefined> | null
  settings?: Record<string, unknown> | null
  breadcrumbs?: Breadcrumb[] | null
}

/** Windows 文件名不能含冒号，ISO 时间必须换写法。 */
export function crashFileName(kind: CrashKind, at: Date): string {
  const stamp = at.toISOString().slice(0, 19).replace(/:/g, '-')
  return `crash-${stamp}-${kind}.log`
}

function megabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function section(title: string, lines: Array<string | null | undefined>): string[] {
  const body = lines.filter((line): line is string => Boolean(line))
  if (!body.length) return []
  return [`-- ${title} --`, ...body, '']
}

function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function formatCrashReport(context: CrashContext): string {
  const lines: string[] = [
    '== FastAgent 崩溃报告 ==',
    `时间: ${context.at.toISOString()}`,
    `类型: ${context.kind}（${CRASH_KIND_LABELS[context.kind]}）`,
    context.detail ? `详情: ${context.detail}` : null,
    ''
  ].filter((line): line is string => line !== null)

  if (context.logLocation) {
    lines.push(...section('日志位置', [
      `目录: ${context.logLocation.dir}`,
      // 回落过就必须说清楚，否则事后有人对着安装目录找不到日志会以为功能没生效。
      context.logLocation.fallback ? `回落: 是（${context.logLocation.reason ?? '原因未知'}）` : '回落: 否'
    ]))
  }

  const runtime = context.runtime
  if (runtime) {
    lines.push(...section('运行环境', [
      `版本: ${runtime.version}`,
      `Electron: ${runtime.electron}  Node: ${runtime.node}  Chrome: ${runtime.chrome}`,
      `平台: ${runtime.platform}`,
      `运行时长: ${runtime.uptimeSeconds.toFixed(1)}s`,
      runtime.memory
        ? `内存: rss=${megabytes(runtime.memory.rss)} heapUsed=${megabytes(runtime.memory.heapUsed)} heapTotal=${megabytes(runtime.memory.heapTotal)} external=${megabytes(runtime.memory.external)}`
        : null,
      ...(runtime.processes ?? []).map((item) => {
        const cpu = item.cpuPercent === undefined ? '' : ` cpu=${item.cpuPercent.toFixed(1)}%`
        const workingSet = item.workingSetKb === undefined ? '' : ` ws=${megabytes(item.workingSetKb * 1024)}`
        return `进程: ${item.type} pid=${item.pid}${cpu}${workingSet}`
      })
    ]))
  }

  if (context.state) {
    lines.push(...section('应用状态', Object.entries(context.state)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${describeValue(value)}`)))
  }

  if (context.settings) {
    lines.push(...section('设置摘要', Object.entries(context.settings).map(([key, value]) => `${key}: ${describeValue(value)}`)))
  }

  if (context.error) {
    lines.push(...section('错误', [
      `消息: ${context.error.message}`,
      context.error.stack ? `堆栈:\n${context.error.stack}` : null,
      context.error.componentStack ? `组件栈:\n${context.error.componentStack}` : null
    ]))
  }

  const breadcrumbs = context.breadcrumbs ?? []
  lines.push(...section(`最近 ${breadcrumbs.length} 条事件`, breadcrumbs.map((item) => `${item.at} [${item.scope}] ${item.message}`)))

  return `${lines.join('\n').trimEnd()}\n`
}
