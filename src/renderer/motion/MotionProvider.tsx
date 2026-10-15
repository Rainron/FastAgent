import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { motionEnabled } from './runtime'

const MotionEnabledContext = createContext(true)

/**
 * 把项目的动效开关接进 Motion for React。
 *
 * 偏好写在 `<html>` 的 data-motion / data-reduced-motion 上（App 维护），CSS 靠这两个属性
 * 把 --motion-* 归零；Motion 走 JS 写 inline style，读不到 CSS 变量，得单独同步一份，
 * 否则「动效：关」之后 CSS 停了、Motion 的弹层还在动。
 *
 * 两侧都用同一个属性源，所以同一次切换里一起停。reducedMotion 取 always 时 Motion 会自动
 * 跳过 transform / layout 动画；opacity 它不拦，靠 useMotionTransition 把时长压成 0。
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const enabled = useMotionSource()
  return (
    <MotionEnabledContext.Provider value={enabled}>
      <MotionConfig reducedMotion={enabled ? 'never' : 'always'} transition={enabled ? undefined : { duration: 0 }}>
        {children}
      </MotionConfig>
    </MotionEnabledContext.Provider>
  )
}

/**
 * 订阅 `<html>` 上的动效开关。系统 prefers-reduced-motion 的变化由 App 转写到属性上，
 * 所以这里只监听属性就够，不必再单独订阅媒体查询。
 */
function useMotionSource(): boolean {
  const [enabled, setEnabled] = useState(motionEnabled)
  useEffect(() => {
    const root = document.documentElement
    const sync = () => setEnabled(motionEnabled())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-motion', 'data-reduced-motion'] })
    return () => observer.disconnect()
  }, [])
  return enabled
}

/** 当前动效是否启用；供需要自己决定「要不要挂动画」的组件读取。 */
export function useMotionEnabled(): boolean {
  return useContext(MotionEnabledContext)
}
