import { useEffect, useState } from 'react'

/** 输入框驱动服务端查询时用：停手 delay 毫秒后才把值放出去，避免逐字打 IPC。 */
export function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return settled
}
