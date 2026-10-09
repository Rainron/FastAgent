import type { ReactNode } from 'react'
import { MOTION_DURATIONS } from './motion'
import { usePresence } from './use-presence'

/**
 * 条件渲染的退场壳：`{value && <X />}` 换成 `<Presence value={value}>{(v) => <X />}</Presence>`，
 * 关闭时保留最后一份内容播完退场再卸载。
 *
 * 外层是 display: contents 的 div，不生成盒子，子元素的定位与布局与直接渲染时一致；
 * 退场动画按 variant 挂在子元素上（CSS 的子选择器照样作用于 contents 容器的子节点）。
 * - pop：弹出层 / 菜单 / 对话框，缩一点并淡出
 * - drop：贴底的条（压力提示、回到底部按钮），往下沉并淡出
 * - fade：纯淡出
 */
export function Presence<T>({ value, variant = 'fade', duration = MOTION_DURATIONS.popoverClose, children }: {
  value: T | null | undefined | false
  variant?: 'pop' | 'drop' | 'fade'
  duration?: number
  children: (item: T) => ReactNode
}) {
  const { item, closing } = usePresence(value === false || value === undefined ? null : value, duration)
  if (item === null) return null
  return <div className={`presence presence-${variant}${closing ? ' closing' : ''}`}>{children(item)}</div>
}
