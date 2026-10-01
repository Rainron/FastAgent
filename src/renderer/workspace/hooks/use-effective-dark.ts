import { useEffect, useState } from 'react'
import type { AppTheme } from '../../../shared/types'

/**
 * 实际生效的亮暗。标题栏的日月图标按它显示，
 * theme 为 system 时跟随系统变化即时刷新。
 */
export function useEffectiveDark(theme: AppTheme) {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return theme === 'dark' || (theme === 'system' && systemDark)
}
