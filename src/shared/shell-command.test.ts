import { describe, expect, it } from 'vitest'
import type { ShellCommandResult } from './types'
import {
  DEFAULT_SHELL_COMMAND_SETTINGS,
  formatShellCommandOutput,
  normalizeShellCommandSettings,
  parseShellCommandInput,
  shellCommandStatusLabel,
  truncateShellOutput,
  unescapeShellCommandInput
} from './shell-command'

function result(patch: Partial<ShellCommandResult> = {}): ShellCommandResult {
  return {
    id: 'sc-1',
    command: 'ls',
    status: 'completed',
    exitCode: 0,
    output: 'a\nb',
    truncated: false,
    error: null,
    cwd: 'K:/repo',
    shell: 'bash',
    durationMs: 12,
    ...patch
  }
}

describe('parseShellCommandInput', () => {
  it('取出 ! 后的命令', () => {
    expect(parseShellCommandInput('!ls -la')).toBe('ls -la')
    expect(parseShellCommandInput('! git status ')).toBe('git status')
  })

  it('不是命令的情况返回 null', () => {
    expect(parseShellCommandInput('ls')).toBeNull()
    expect(parseShellCommandInput('!')).toBeNull()
    expect(parseShellCommandInput('!   ')).toBeNull()
    expect(parseShellCommandInput('这句话里有 !ls')).toBeNull()
  })

  it('!! 是转义，不当命令', () => {
    expect(parseShellCommandInput('!!ls')).toBeNull()
    expect(unescapeShellCommandInput('!!ls')).toBe('!ls')
    expect(unescapeShellCommandInput('!ls')).toBe('!ls')
  })

  it('关闭命令功能时保留普通消息中的双感叹号', () => {
    expect(unescapeShellCommandInput('!!ls', false)).toBe('!!ls')
  })
})

describe('normalizeShellCommandSettings', () => {
  it('缺省时给默认值', () => {
    expect(normalizeShellCommandSettings(undefined)).toEqual(DEFAULT_SHELL_COMMAND_SETTINGS)
  })

  it('非法落点与超时回退', () => {
    const next = normalizeShellCommandSettings({ output: 'nope' as never, timeoutSeconds: Number.NaN })
    expect(next.output).toBe('local')
    expect(next.timeoutSeconds).toBe(60)
  })

  it('超时钳到区间内并取整', () => {
    expect(normalizeShellCommandSettings({ timeoutSeconds: 0 }).timeoutSeconds).toBe(1)
    expect(normalizeShellCommandSettings({ timeoutSeconds: 10_000 }).timeoutSeconds).toBe(600)
    expect(normalizeShellCommandSettings({ timeoutSeconds: 12.6 }).timeoutSeconds).toBe(13)
  })
})

describe('truncateShellOutput', () => {
  it('未超限原样返回', () => {
    expect(truncateShellOutput('abc', 10)).toEqual({ text: 'abc', truncated: false })
  })

  it('超限时保留末尾', () => {
    expect(truncateShellOutput('abcdef', 3)).toEqual({ text: 'def', truncated: true })
  })
})

describe('formatShellCommandOutput', () => {
  it('围栏里带命令与退出码', () => {
    expect(formatShellCommandOutput(result())).toBe('```console\n$ ls\na\nb\n```\n（退出码 0）')
  })

  it('空输出与截断都写进注记', () => {
    const text = formatShellCommandOutput(result({ output: '   ', truncated: true, exitCode: 1 }))
    expect(text).toContain('（无输出）')
    expect(text).toContain('退出码 1')
    expect(text).toContain('输出过长')
  })

  it('终止与超时有各自的说法', () => {
    expect(shellCommandStatusLabel({ status: 'cancelled', exitCode: null })).toBe('已终止')
    expect(shellCommandStatusLabel({ status: 'timeout', exitCode: null })).toBe('已超时')
    expect(shellCommandStatusLabel({ status: 'failed', exitCode: null })).toBe('执行失败')
  })

  it('执行失败仍保留非零退出码', () => {
    expect(shellCommandStatusLabel({ status: 'failed', exitCode: 127 })).toBe('执行失败，退出码 127')
  })

  it('命令输出包含代码围栏时不会提前闭合', () => {
    expect(formatShellCommandOutput(result({ output: '```\n内容' }))).toBe('````console\n$ ls\n```\n内容\n````\n（退出码 0）')
  })
})
