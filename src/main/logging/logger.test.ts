import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { breadcrumb, initLogging, logAppError, logIntegrationError, writeCrashReport } from './logger'

let dir = ''
let root = ''

function read(name: string) {
  return readFileSync(join(dir, name), 'utf8')
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fa-logger-'))
  dir = join(root, 'logs')
  // 打包态分支：日志落在「安装目录」（这里用临时目录冒充）下的 logs。
  initLogging({ packaged: true, execPath: join(root, 'FastAgent.exe'), projectRoot: root, userDataLogs: join(root, 'userdata-logs') })
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('initLogging', () => {
  it('优先落在安装目录下的 logs', () => {
    expect(readdirSync(root)).toContain('logs')
  })

  it('安装目录不可写时回落，并把原因带进崩溃报告', () => {
    const fallbackDir = join(root, 'userdata-logs')
    const location = initLogging({
      packaged: true,
      execPath: join(root, 'FastAgent.exe'),
      projectRoot: root,
      userDataLogs: fallbackDir,
      probe: (target) => target === fallbackDir
    })
    expect(location.fallback).toBe(true)
    writeCrashReport({ kind: 'main-uncaught', at: new Date(), error: { message: '炸了' } })
    const report = readFileSync(join(fallbackDir, readdirSync(fallbackDir)[0]), 'utf8')
    expect(report).toContain('回落: 是')
  })
})

describe('分类落盘', () => {
  it('应用错误进 error 日志，带堆栈', () => {
    logAppError('ipc conversations:history', new Error('会话不存在'))
    const content = read(`error-${today()}.log`)
    expect(content).toContain('ipc conversations:history: 会话不存在')
    expect(content).toContain('Error: 会话不存在')
  })

  it('应用错误可附带结构化补充信息', () => {
    logAppError('workspace', new Error('读取失败'), { path: 'a/b.txt' })
    expect(read(`error-${today()}.log`)).toContain('{"path":"a/b.txt"}')
  })

  it('外部服务错误进 integration 日志，且不与应用错误混在一起', () => {
    logIntegrationError({ service: 'backend', endpoint: 'POST /api/v1/auth/login', status: 502, message: '网关错误', durationMs: 120 })
    const content = read(`integration-${today()}.log`)
    expect(content).toContain('[backend] POST /api/v1/auth/login status=502 120ms - 网关错误')
    expect(readdirSync(dir)).not.toContain(`error-${today()}.log`)
  })

  it('缺省的 status 与耗时不会写成 undefined', () => {
    logIntegrationError({ service: 'mcp', endpoint: 'github', message: '连接超时' })
    expect(read(`integration-${today()}.log`)).not.toContain('undefined')
  })

  it('调用方已脱敏的消息原样落盘，不会被再次改写', () => {
    logIntegrationError({ service: 'model', endpoint: 'openai/gpt-4', message: 'invalid key ***' })
    const content = read(`integration-${today()}.log`)
    expect(content).toContain('invalid key ***')
  })
})

describe('writeCrashReport', () => {
  it('把面包屑一并写进报告', () => {
    breadcrumb('ipc', 'chat:send')
    logAppError('ipc chat:send', new Error('模型不可用'))
    const path = writeCrashReport({ kind: 'renderer-gone', at: new Date(), detail: 'reason=crashed' })
    expect(path).not.toBeNull()
    const report = readFileSync(path as string, 'utf8')
    expect(report).toContain('reason=crashed')
    expect(report).toContain('[ipc] chat:send')
    // logAppError 会顺带留一条面包屑，崩溃前报过什么错要能看到
    expect(report).toContain('[error] ipc chat:send: 模型不可用')
  })

  it('文件名可直接落在 Windows 上', () => {
    const path = writeCrashReport({ kind: 'child-gone', at: new Date(), detail: 'type=GPU' })
    expect(path?.split(/[\\/]/).at(-1)).toMatch(/^crash-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-child-gone\.log$/)
  })

  it('反复崩溃时只保留最近 20 份报告', () => {
    for (let index = 0; index < 25; index += 1) {
      writeCrashReport({ kind: 'unresponsive', at: new Date(Date.UTC(2026, 8, 2, 0, 0, index)) })
    }
    const reports = readdirSync(dir).filter((name) => name.startsWith('crash-'))
    expect(reports).toHaveLength(20)
    // 留下的应当是最新的那批
    expect(reports.sort().at(-1)).toContain('T00-00-24')
  })
})
