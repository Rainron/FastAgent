import { useMemo } from 'react'
import type { Transition } from 'motion/react'
import { MOTION_EASE, motionSeconds } from './tokens'
import { useMotionEnabled } from './MotionProvider'

/**
 * 给 Motion 组件用的过渡配置，与 CSS 的 --motion-* 取同一个值。
 *
 * 动效关闭时返回 0 时长：MotionConfig 的 reducedMotion 只拦得下 transform / layout，
 * opacity 它照样会动，所以这里要再压一道，保证「动效：关」是彻底不动。
 */
export function useMotionTransition(duration: number): Transition {
  const enabled = useMotionEnabled()
  return useMemo(
    () => (enabled ? { duration: motionSeconds(duration), ease: MOTION_EASE } : { duration: 0 }),
    [enabled, duration]
  )
}
