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
