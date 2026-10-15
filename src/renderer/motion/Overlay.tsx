import { AnimatePresence, motion } from 'motion/react'
import type { CSSProperties, ReactNode, Ref } from 'react'
import { MOTION_DURATIONS } from './tokens'
import { useMotionTransition } from './use-motion-transition'

/**
 * 弹层基元：遮罩 + 内容盒，两层用同一个时长**同步出现、同步消失**。
 *
 * 这是替换前的最大一处不一致：遮罩没有任何动画（0ms 硬切），内容却淡入 140ms，
 * 两层差的是一整段时长——看着像内容从一块已经铺好的底色上浮出来。
 *
 * 内容只做极轻的放大（0.98 → 1）配透明度，不再叠加 translateY：
 * 位移会把「出现在原地的对话框」演成「从下面弹上来」，即使用户说的「明显跳动」。
 *
 * 进场 200ms、退场 140ms（tokens 的 dialog / dialogClose 一档）。退场是纯视觉的，
 * 不阻塞业务——调用方在 onRespond 里该做什么照旧立刻做。
 */
export function Overlay({ open, className = 'approval-overlay', panelClassName, panelStyle, label, role = 'dialog', overlayRef, tabIndex, onBackdropPointerDown, children }: {
  open: boolean
  /** 遮罩层的类名，默认复用审批弹层那一套。 */
  className?: string
  /** 内容盒的类名。 */
  panelClassName?: string
  panelStyle?: CSSProperties
  label?: string
  /** 需要用户立即回应的确认层用 alertdialog。 */
  role?: 'dialog' | 'alertdialog'
  /** 遮罩层的 ref：个别弹层要拿它做焦点或滚动管理。 */
  overlayRef?: Ref<HTMLDivElement>
  tabIndex?: number
  /** 点击遮罩（而非内容）时触发。 */
  onBackdropPointerDown?: () => void
  children: ReactNode
}) {
  const enter = useMotionTransition(MOTION_DURATIONS.dialog)
  const exit = useMotionTransition(MOTION_DURATIONS.dialogClose)
  return <AnimatePresence>
    {open && <motion.div
      ref={overlayRef}
      tabIndex={tabIndex}
      className={className}
      role={role}
      aria-modal="true"
      aria-label={label}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: enter }}
      exit={{ opacity: 0, transition: exit }}
      onPointerDown={onBackdropPointerDown ? (event) => { if (event.target === event.currentTarget) onBackdropPointerDown() } : undefined}
    >
      <motion.div
        className={panelClassName}
        style={panelStyle}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1, transition: enter }}
        exit={{ opacity: 0, scale: 0.98, transition: exit }}
      >
        {children}
      </motion.div>
    </motion.div>}
  </AnimatePresence>
}
