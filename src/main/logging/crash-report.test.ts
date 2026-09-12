import { describe, expect, it } from 'vitest'
import { crashFileName, formatCrashReport, type CrashContext } from './crash-report'

const at = new Date('2026-09-02T06:51:03.123Z')

function contextOf(patch: Partial<CrashContext> = {}): CrashContext {
  return { kind: 'renderer-gone', at, ...patch }
}

describe('crashFileName', () => {
  it('用时间戳与类型命名', () => {
    expect(crashFileName('renderer-gone', at)).toBe('crash-2026-09-02T06-51-03-renderer-gone.log')
  })

  it('不含 Windows 文件名非法字符', () => {
    const name = crashFileName('main-uncaught', at)
    expect(name).not.toMatch(/[:*?"<>|]/)
  })
})

describe('formatCrashReport', () => {
  it('最小上下文也能出报告，且不出现 undefined', () => {
    const report = formatCrashReport(contextOf())
    expect(report).toContain('== FastAgent 崩溃报告 ==')
    expect(report).toContain('时间: 2026-09-02T06:51:03.123Z')
    expect(report).toContain('类型: renderer-gone（渲染进程退出）')
    expect(report).not.toContain('undefined')
    expect(report.endsWith('\n')).toBe(true)
  })

  it('回落时写明原因，避免有人对着安装目录找不到日志', () => {
    const report = formatCrashReport(contextOf({
      logLocation: { dir: 'C:\\Users\\lake\\AppData\\Roaming\\fastagent-desktop\\logs', fallback: true, reason: '首选目录不可写：C:\\Program Files\\FastAgent\\logs' }
    }))
    expect(report).toContain('回落: 是（首选目录不可写：C:\\Program Files\\FastAgent\\logs）')
  })

  it('输出环境、状态与错误堆栈', () => {
    const report = formatCrashReport(contextOf({
      kind: 'main-uncaught',
      detail: 'exitCode=1',
      runtime: {
        version: '1.0.0',
        electron: '43.0.0',
        node: '22.0.0',
        chrome: '130',
        platform: 'win32 x64',
        uptimeSeconds: 12.34,
        memory: { rss: 180 * 1024 * 1024, heapUsed: 64 * 1024 * 1024, heapTotal: 96 * 1024 * 1024, external: 8 * 1024 * 1024 },
        processes: [{ type: 'Browser', pid: 123, cpuPercent: 1.25, workingSetKb: 180 * 1024 }]
      },
      state: { authState: 'ready', workspaceRoot: null, activeRuns: 2 },
      error: { message: '炸了', stack: 'Error: 炸了\n    at foo' }
    }))
    expect(report).toContain('详情: exitCode=1')
    expect(report).toContain('运行时长: 12.3s')
    expect(report).toContain('rss=180.0MB')
    expect(report).toContain('进程: Browser pid=123 cpu=1.3% ws=180.0MB')
    expect(report).toContain('workspaceRoot: null')
    expect(report).toContain('activeRuns: 2')
    expect(report).toContain('at foo')
  })

  it('渲染层异常带上组件栈', () => {
    const report = formatCrashReport(contextOf({
      kind: 'renderer-error',
      error: { message: '渲染出错', stack: 'Error: 渲染出错', componentStack: '    at WorkspaceShell' }
    }))
    expect(report).toContain('组件栈:')
    expect(report).toContain('at WorkspaceShell')
  })

  it('面包屑按时间正序输出并标注条数', () => {
    const report = formatCrashReport(contextOf({
      breadcrumbs: [
        { at: '2026-09-02T06:51:00.100Z', scope: 'ipc', message: 'chat:send' },
        { at: '2026-09-02T06:51:01.200Z', scope: 'run', message: 'start run=1' }
      ]
    }))
    expect(report).toContain('-- 最近 2 条事件 --')
    expect(report.indexOf('chat:send')).toBeLessThan(report.indexOf('start run=1'))
  })

  it('没有的段落整段不输出', () => {
    const report = formatCrashReport(contextOf())
    expect(report).not.toContain('-- 运行环境 --')
    expect(report).not.toContain('-- 错误 --')
    expect(report).not.toContain('-- 应用状态 --')
  })

  it('state 里的 undefined 字段被剔除', () => {
    const report = formatCrashReport(contextOf({ state: { authState: 'ready', missing: undefined } }))
    expect(report).toContain('authState: ready')
    expect(report).not.toContain('missing')
  })
})
