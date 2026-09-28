import type { AppSettings } from '../shared/types'

export type MotionPreference = 'system' | 'on' | 'off'

export const MOTION_DURATIONS = {
  hover: 120, press: 100, pageEnter: 180, conversationEnter: 160, sidebar: 220,
  popoverOpen: 140, popoverClose: 100, expand: 180, newConversation: 200,
  focus: 140, newMessage: 160, status: 180, copyOrChange: 140
} as const

export const MOTION_EASING = 'cubic-bezier(0.2, 0, 0, 1)'

export function resolveMotionMode(preference: MotionPreference, prefersReducedMotion: boolean): boolean {
  return preference === 'on' || (preference === 'system' && !prefersReducedMotion)
}

export function motionPreference(settings: AppSettings | null): MotionPreference {
  return settings?.motionPreference ?? 'system'
}

/**
 * 读当前动效是否启用：App 启动时把偏好写到了 :root 的 data-motion / data-reduced-motion 上。
 * 只在需要间或判定的场合同步读一次（如退场前），不要放进渲染路径。
 */
export function motionEnabled(): boolean {
  if (typeof document === 'undefined') return false
  const root = document.documentElement
  if (root.dataset.motion === 'off') return false
  if (root.dataset.motion === 'system') return root.dataset.reducedMotion !== 'true'
  return true
}
