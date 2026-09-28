import { useEffect, useState } from 'react'
import { motionEnabled } from './motion'

export type UnmountDecision = 'keep' | 'immediate' | 'delayed'

/**
 * 退场决策表（纯函数便于无 DOM 环境测试）：
 * 打开中或从未挂载 → 保持现状；动效开启且有时长 → 延迟卸载给退场动画留窗口；否则立即卸载。
 */
export function unmountDecision(open: boolean, mounted: boolean, duration: number, motionOn: boolean): UnmountDecision {
  if (open || !mounted) return 'keep'
  return motionOn && duration > 0 ? 'delayed' : 'immediate'
}

/**
 * 条件渲染 `{open && ...}` 的动效版：open 变 false 后延迟 duration 毫秒才真正卸载，
 * 期间调用方给元素挂 closing class 播退场动画。动效偏好关闭时不延迟，避免可见的关不干净。
 */
export function useDelayedUnmount(open: boolean, duration: number): boolean {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      if (!mounted) setMounted(true)
      return
    }
    // 动效开关只在关闭瞬间读一次：偏好是低频设置，不值得为此订阅重渲染
    const decision = unmountDecision(open, mounted, duration, motionEnabled())
    if (decision === 'immediate') {
      if (mounted) setMounted(false)
      return
    }
    if (decision === 'delayed') {
      const timer = setTimeout(() => setMounted(false), duration)
      return () => clearTimeout(timer)
    }
    return
  }, [open, duration, mounted])
  return mounted
}
