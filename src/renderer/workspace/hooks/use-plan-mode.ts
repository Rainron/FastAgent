import { useEffect, useState } from 'react'

/**
 * 计划模式：开启后本回合只产出实施计划。
 * Shift+Tab 走全局监听，焦点在输入框外也能切；同时阻止默认的焦点反向移动。
 */
export function usePlanMode() {
  const [planMode, setPlanMode] = useState(false)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault()
      setPlanMode((current) => !current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return { planMode, setPlanMode }
}
