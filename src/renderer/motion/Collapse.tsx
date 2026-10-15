import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { MOTION_DURATIONS } from './tokens'
import { useDelayedUnmount } from './use-delayed-unmount'
import { useMotionTransition } from './use-motion-transition'

/**
 * 展开 / 折叠容器。
 *
 * 高度动画交给 Motion for React 的 `height: 0 ↔ auto`：内容高度未知也能真正「长出来」，
 * 不用先量一遍再写死 px，也就不会在内容变化时卡在旧高度上。
 * 关闭时由 useDelayedUnmount 留住节点，等收起动画播完再卸载子节点——折叠不是一帧消失，
 * 同时避免了折叠态的子树常驻 DOM（资源树、会话列表这类内容量不小）。
 *
 * overflow 用 clip 而不是 hidden：hidden 会让内部的 position: sticky（展开后吸顶的卡片头部）失效。
 *
 * duration 默认取 sidebar 一档（220ms）：侧栏分区、资源树、执行轨迹这些原本共用同一节奏，
 * 单个场景需要更快时再显式传（例如执行轨迹详情用 expand 一档）。
 *
 * appear=false 时首次挂载就处于展开态、不播展开动画：对话历史里默认展开的块
 * 一打开会话就齐刷刷往下长，既晃眼又白白触发整页重排。
 */
export function Collapse({ open, className, appear = true, duration = MOTION_DURATIONS.sidebar, children }: {
  open: boolean
  className?: string
  appear?: boolean
  duration?: number
  children: ReactNode
}) {
  const mounted = useDelayedUnmount(open, duration)
  const transition = useMotionTransition(duration)
  if (!mounted) return null
  return <motion.div
    className={`collapse${className ? ` ${className}` : ''}`}
    initial={appear ? 'closed' : false}
    animate={open ? 'open' : 'closed'}
    variants={{ open: { height: 'auto', opacity: 1 }, closed: { height: 0, opacity: 0 } }}
    transition={transition}
  >
    <motion.div className="collapse-inner" variants={{ open: { y: 0 }, closed: { y: -3 } }} transition={transition}>
      {children}
    </motion.div>
  </motion.div>
}
