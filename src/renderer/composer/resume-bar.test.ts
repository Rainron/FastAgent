import { describe, expect, it } from 'vitest'
import type { ResumableRun } from '../../shared/types'
import { resumeBarLabel, resumeReasonLabel, shouldShowResumeBar } from './resume-bar'

function run(patch: Partial<ResumableRun>): ResumableRun {
  return {
    runId: 'run-1',
    conversationId: 'c1',
    turnId: 't1',
    goal: '改登录页',
    reason: null,
    errorKind: null,
    pendingTodos: 0,
    changedFiles: 0,
    interruptedAt: 0,
    ...patch
  }
}

describe('shouldShowResumeBar', () => {
  it('有中断运行且当前空闲时展示', () => {
    expect(shouldShowResumeBar({ resumable: run({}), running: false })).toBe(true)
  })

  it('正在执行时不展示：会话级串行，续跑点了也跑不起来', () => {
    expect(shouldShowResumeBar({ resumable: run({}), running: true })).toBe(false)
  })

  it('没有可续跑运行时不展示', () => {
    expect(shouldShowResumeBar({ resumable: null, running: false })).toBe(false)
  })
})

describe('resumeReasonLabel', () => {
  it('按归类给出对应说明', () => {
    expect(resumeReasonLabel(run({ errorKind: 'network' }))).toBe('网络中断')
    expect(resumeReasonLabel(run({ errorKind: 'permission' }))).toBe('权限被拒')
    expect(resumeReasonLabel(run({ errorKind: 'sandbox' }))).toBe('沙箱阻止')
  })

  it('没有归类时退回原始原因', () => {
    expect(resumeReasonLabel(run({ errorKind: null, reason: '任务已中断' }))).toBe('任务已中断')
  })

  it('归类与原因都缺时有兜底文案', () => {
    expect(resumeReasonLabel(run({ errorKind: null, reason: '   ' }))).toBe('任务中断')
  })
})

describe('resumeBarLabel', () => {
  it('同时给出剩余待办与已改文件', () => {
    expect(resumeBarLabel(run({ errorKind: 'network', pendingTodos: 3, changedFiles: 2 })))
      .toBe('网络中断 · 剩 3 项未完成 · 已改 2 个文件')
  })

  it('为 0 的那一项不出现', () => {
    expect(resumeBarLabel(run({ errorKind: 'timeout', pendingTodos: 0, changedFiles: 1 })))
      .toBe('请求超时 · 已改 1 个文件')
  })
})
