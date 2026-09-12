import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDailyLogWriter, pruneDailyLogs } from './daily-log'

let dir = ''

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fa-log-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

/** 可推进的假时钟：按天分文件必须能在测试里跨天，不能等真实时间。 */
function clockAt(day: number) {
  let current = day
  return { now: () => new Date(Date.UTC(2026, 8, current)), advance: (days: number) => { current += days } }
}

describe('createDailyLogWriter', () => {
  it('写入以日期命名的文件，目录不存在时自建', () => {
    const target = join(dir, 'nested')
    const clock = clockAt(2)
    const writer = createDailyLogWriter({ dir: target, prefix: 'error', keepDays: 14, now: clock.now })
    writer.append('第一条')
    expect(readFileSync(join(target, 'error-2026-09-02.log'), 'utf8')).toBe('第一条\n')
  })

  it('同一天追加到同一个文件，不重复换行', () => {
    const clock = clockAt(2)
    const writer = createDailyLogWriter({ dir, prefix: 'error', keepDays: 14, now: clock.now })
    writer.append('a')
    writer.append('b\n')
    expect(readFileSync(join(dir, 'error-2026-09-02.log'), 'utf8')).toBe('a\nb\n')
  })

  it('跨天切到新文件', () => {
    const clock = clockAt(2)
    const writer = createDailyLogWriter({ dir, prefix: 'error', keepDays: 14, now: clock.now })
    writer.append('第一天')
    clock.advance(1)
    writer.append('第二天')
    expect(readFileSync(join(dir, 'error-2026-09-02.log'), 'utf8')).toBe('第一天\n')
    expect(readFileSync(join(dir, 'error-2026-09-03.log'), 'utf8')).toBe('第二天\n')
  })

  it('跨天时裁掉超出保留天数的旧文件', () => {
    const clock = clockAt(1)
    const writer = createDailyLogWriter({ dir, prefix: 'error', keepDays: 3, now: clock.now })
    for (let day = 0; day < 6; day += 1) {
      writer.append(`第 ${day} 天`)
      clock.advance(1)
    }
    writer.append('最后一天')
    const files = readdirSync(dir).sort()
    expect(files).toEqual(['error-2026-09-05.log', 'error-2026-09-06.log', 'error-2026-09-07.log'])
  })

  it('不误删其它前缀的日志', () => {
    writeFileSync(join(dir, 'integration-2026-01-01.log'), 'x', 'utf8')
    writeFileSync(join(dir, 'startup.log'), 'x', 'utf8')
    pruneDailyLogs(dir, 'error', 0)
    expect(readdirSync(dir).sort()).toEqual(['integration-2026-01-01.log', 'startup.log'])
  })

  it('写入失败不外溢——日志故障不能反过来打断主流程', () => {
    const writer = createDailyLogWriter({ dir: join(dir, 'a\0b'), prefix: 'error', keepDays: 14 })
    expect(() => writer.append('x')).not.toThrow()
  })
})
