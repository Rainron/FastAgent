import { describe, expect, it } from 'vitest'
import { appendOutput, describeTask, tailLines, type BackgroundTask } from './background-shell'

const MAX_OUTPUT_BYTES = 128 * 1024

function task(patch: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: 'bg-1',
    name: 'api server',
    command: 'npm run dev',
    cwd: 'K:/demo',
    status: 'running',
    startedAt: 1_000,
    finishedAt: null,
    exitCode: null,
    error: null,
    ...patch
  }
}

describe('background shell 输出缓冲', () => {
  it('未超上限时原样累加', () => {
    const record = { output: '', droppedBytes: 0 }
    appendOutput(record, 'a')
    appendOutput(record, 'b')
    expect(record).toEqual({ output: 'ab', droppedBytes: 0 })
  })

  it('超出上限时丢最早的部分并记账', () => {
    const record = { output: 'x'.repeat(MAX_OUTPUT_BYTES), droppedBytes: 0 }
    appendOutput(record, 'yz')
    expect(record.output).toHaveLength(MAX_OUTPUT_BYTES)
    expect(record.output.endsWith('yz')).toBe(true)
    expect(record.droppedBytes).toBe(2)
  })
})

describe('background shell 输出截取', () => {
  it('取末尾若干行', () => {
    expect(tailLines('1\n2\n3\n4', 2)).toBe('3\n4')
  })

  it('行数超出总行数时返回全部，非正数按 1 行处理', () => {
    expect(tailLines('1\n2', 10)).toBe('1\n2')
    expect(tailLines('1\n2', 0)).toBe('2')
    expect(tailLines('1\n2', -5)).toBe('2')
  })
})

describe('background shell 状态描述', () => {
  it('运行中报已运行时长', () => {
    const text = describeTask(task({ startedAt: Date.now() - 5_000 }))
    expect(text).toContain('bg-1 [api server] 已运行')
    expect(text).toContain('命令：npm run dev')
  })

  it('退出与停止分别标注，退出码缺失时不显示空值', () => {
    expect(describeTask(task({ status: 'exited', finishedAt: 3_000, exitCode: 0 }))).toContain('已退出（退出码 0，运行 2s）')
    expect(describeTask(task({ status: 'stopped', finishedAt: 3_000, exitCode: null }))).toContain('已停止（退出码 未知，运行 2s）')
  })

  it('失败时给出原因', () => {
    expect(describeTask(task({ status: 'failed', finishedAt: 2_000, error: '找不到 npm' }))).toContain('失败：找不到 npm')
  })
})
