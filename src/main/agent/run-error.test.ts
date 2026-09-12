import { describe, expect, it } from 'vitest'
import { classifyRunError } from './run-error'
import { SandboxError } from './sandbox/sandbox-errors'

describe('classifyRunError', () => {
  it('取消不重试', () => {
    expect(classifyRunError(new DOMException('已取消', 'AbortError'))).toMatchObject({ kind: 'cancelled', retryable: false, backoffMs: null })
  })

  it('丢了原型的 AbortError 同样按取消处理', () => {
    // IPC 往返或跨 realm 之后 DOMException 的 instanceof 判定会失效，只剩 name 可依
    const error = new Error('已取消')
    error.name = 'AbortError'
    expect(classifyRunError(error).kind).toBe('cancelled')
  })

  it('沙箱违规立即停止，不自动重试', () => {
    expect(classifyRunError(new SandboxError('filesystem_denied'))).toMatchObject({ kind: 'sandbox', retryable: false, backoffMs: null })
  })

  it('权限拒绝不自动重试', () => {
    for (const message of ['权限规则禁止执行（shell）', '用户拒绝了该操作：write a.ts', '计划模式禁止写入操作（edit）', '操作未获批准：bash']) {
      expect(classifyRunError(new Error(message)), message).toMatchObject({ kind: 'permission', retryable: false })
    }
  })

  it('权限拒绝优先于文本模式：消息里带路径也不会被误判', () => {
    // 这条消息同时含「操作未获批准」与会命中 timeout 模式的字样
    expect(classifyRunError(new Error('操作未获批准：bash timeout 30')).kind).toBe('permission')
  })

  it('限流与网络故障可重试并指数退避', () => {
    expect(classifyRunError(new Error('HTTP 429 Too Many Requests'), 0)).toMatchObject({ kind: 'network', retryable: true, backoffMs: 1_000 })
    expect(classifyRunError(new Error('fetch failed: ECONNRESET'), 2)).toMatchObject({ kind: 'network', retryable: true, backoffMs: 4_000 })
    expect(classifyRunError(new Error('502 Bad Gateway'), 3).backoffMs).toBe(8_000)
  })

  it('退避有上限，不会无限拉长', () => {
    expect(classifyRunError(new Error('ETIMEDOUT'), 99).backoffMs).toBe(30_000)
  })

  it('超时用固定退避', () => {
    expect(classifyRunError(new Error('request timed out'))).toMatchObject({ kind: 'timeout', retryable: true, backoffMs: 2_000 })
    expect(classifyRunError(new Error('模型调用超时')).kind).toBe('timeout')
  })

  it('参数错误不重试', () => {
    expect(classifyRunError(new Error('invalid request: schema validation failed'))).toMatchObject({ kind: 'validation', retryable: false, backoffMs: null })
  })

  it('模型侧异常可重试但不退避', () => {
    expect(classifyRunError(new Error('模型响应异常'))).toMatchObject({ kind: 'model', retryable: true, backoffMs: null })
    expect(classifyRunError(new Error('未选择可用模型')).kind).toBe('model')
  })

  it('无法归类的兜底为 system 且不重试', () => {
    expect(classifyRunError(new Error('磁盘写入失败'))).toMatchObject({ kind: 'system', retryable: false })
  })

  it('非 Error 输入不抛异常', () => {
    expect(classifyRunError('ECONNREFUSED').kind).toBe('network')
    expect(classifyRunError(undefined)).toMatchObject({ kind: 'system', message: '运行失败' })
  })

  it('不自动重试的四类恒为 retryable false', () => {
    const nonRetryable = [
      new DOMException('已取消', 'AbortError'),
      new SandboxError('network_denied'),
      new Error('权限规则禁止执行（edit）'),
      new Error('invalid parameter')
    ]
    for (const error of nonRetryable) {
      const classified = classifyRunError(error)
      expect(classified.retryable, classified.kind).toBe(false)
      expect(classified.backoffMs, classified.kind).toBeNull()
    }
  })
})
