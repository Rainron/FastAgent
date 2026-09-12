import { useEffect, useState } from 'react'
import type React from 'react'

/** 底栏控件在窗口收窄时逐级降级：完整名称 → 缩写 → 收进「···」。 */
export type ComposerDensity = 'wide' | 'medium' | 'compact'

export function useComposerDensity(ref: React.RefObject<HTMLElement | null>): ComposerDensity {
  const [density, setDensity] = useState<ComposerDensity>('wide')
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setDensity(width < 470 ? 'compact' : width < 620 ? 'medium' : 'wide')
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return density
}
