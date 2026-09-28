import { useCallback, useRef, useState } from 'react'
import { MOTION_DURATIONS, motionEnabled } from './motion'

/**
 * 抽屉内部退场：拦截 onClose（Esc / 遮罩 / 关闭按钮），先播滑出动画再真正卸载，
 * 父组件不需要为退场改条件渲染。动效偏好关闭时直通不等待；
 * 父组件主动改状态卸载（如「保存并打开下一个」）不经这里，保持即时。
 */
export function useDrawerExit(onClose: () => void, duration: number = MOTION_DURATIONS.sidebar) {
  const [closing, setClosing] = useState(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const pending = useRef(false)
  const requestClose = useCallback(() => {
    if (pending.current) return
    if (!motionEnabled()) { onCloseRef.current(); return }
    pending.current = true
    setClosing(true)
    // 略长于 CSS 时长，避免动画末帧被卸载截断
    setTimeout(() => onCloseRef.current(), duration + 40)
  }, [duration])
  return { closing, requestClose }
}
