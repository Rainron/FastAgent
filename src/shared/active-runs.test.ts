import { describe, expect, it } from 'vitest'
import { isRunConflictError, RUN_CONFLICT_MESSAGE } from './active-runs'

describe('isRunConflictError', () => {
  it('认出 Electron 包装过的冲突错误', () => {
    const wrapped = new Error(`Error invoking remote method 'chat:send': Error: ${RUN_CONFLICT_MESSAGE}`)
    expect(isRunConflictError(wrapped)).toBe(true)
  })

  it('认出未包装的冲突错误与字符串形式', () => {
    expect(isRunConflictError(new Error(RUN_CONFLICT_MESSAGE))).toBe(true)
    expect(isRunConflictError(RUN_CONFLICT_MESSAGE)).toBe(true)
  })

  it('其他错误不算冲突', () => {
    expect(isRunConflictError(new Error('会话不存在'))).toBe(false)
    expect(isRunConflictError(null)).toBe(false)
    expect(isRunConflictError(undefined)).toBe(false)
  })
})
