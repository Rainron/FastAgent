import { useCallback, useState } from 'react'

/**
 * 统一的异步动作状态：按 key 记录进行中与失败原因，
 * 让列表里每一行都能各自禁用按钮、各自展示错误，而不互相覆盖。
 */
export function useAsyncActions() {
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const clearError = useCallback((key: string) => {
    setErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])

  const run = useCallback(async <T>(key: string, action: () => Promise<T>): Promise<T | undefined> => {
    setPending((current) => ({ ...current, [key]: true }))
    clearError(key)
    try {
      return await action()
    } catch (error) {
      setErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : String(error) }))
      return undefined
    } finally {
      setPending((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }, [clearError])

  return {
    run,
    clearError,
    isPending: (key: string) => Boolean(pending[key]),
    errorOf: (key: string) => errors[key] ?? null,
    anyPending: Object.keys(pending).length > 0
  }
}
