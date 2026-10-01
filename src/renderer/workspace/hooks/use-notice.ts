import { useEffect, useState } from 'react'
import { MOTION_DURATIONS } from '../../motion'

/** 带动作的提示要留够点击时间，2.4 秒不足以让人看完再点。 */
const PLAIN_NOTICE_MS = 2400
const ACTIONABLE_NOTICE_MS = 5000

export interface NoticeAction {
  label: string
  run: () => void
}

/**
 * 顶部提示条：一条文案 + 可选动作，到点先播淡出再卸载。
 * 与业务无关，任何地方 setNotice 一下即可。
 */
export function useNotice() {
  const [notice, setNotice] = useState('')
  /** 提示条上的附加动作；启动告警用它挂「查看日志」。 */
  const [noticeAction, setNoticeAction] = useState<NoticeAction | null>(null)
  const [noticeClosing, setNoticeClosing] = useState(false)

  useEffect(() => {
    if (!notice) return
    // 换新提示时复位退场标记，重新计时；真正的清空交给退场 effect。
    setNoticeClosing(false)
    const timer = window.setTimeout(() => setNoticeClosing(true), noticeAction ? ACTIONABLE_NOTICE_MS : PLAIN_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice, noticeAction])

  // 退场窗口：先播淡出再卸载，避免到点直接闪没。
  useEffect(() => {
    if (!noticeClosing) return
    const timer = window.setTimeout(() => { setNotice(''); setNoticeAction(null); setNoticeClosing(false) }, MOTION_DURATIONS.popoverClose)
    return () => window.clearTimeout(timer)
  }, [noticeClosing])

  return { notice, noticeAction, noticeClosing, setNotice, setNoticeAction }
}
