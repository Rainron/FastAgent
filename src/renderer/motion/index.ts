/**
 * 渲染层动效的统一入口。
 *
 * 分工：
 * - 简单反馈（hover / press / 颜色）留在 CSS：合成器友好，不必每帧过 JS。
 * - 进出场与布局衔接走 Motion for React：需要编排、需要知道动画何时结束（退场）。
 * - 需要「不生成盒子」的退场壳（Presence / panel-presence）仍由 CSS 关键帧驱动，
 *   详见 Presence.tsx 的说明——那是布局契约，不是可以随手换掉的实现细节。
 */
export { MOTION_DURATIONS, MOTION_EASING, MOTION_EASE, motionSeconds, type MotionPreference } from './tokens'
export { motionEnabled, motionPreference, resolveMotionMode } from './runtime'
export { MotionProvider, useMotionEnabled } from './MotionProvider'
export { useMotionTransition } from './use-motion-transition'
export { Collapse } from './Collapse'
export { Overlay } from './Overlay'
export { Presence } from './Presence'
export { usePresence, useExitingItems } from './use-presence'
export { useDelayedUnmount, unmountDecision, type UnmountDecision } from './use-delayed-unmount'
export { useHeightAnimation } from './use-height-animation'
export { useDrawerExit } from './use-drawer-exit'
export { useScrollAnchor, alignStartIfAbove } from './scroll-anchor'
