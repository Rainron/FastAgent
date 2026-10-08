import { useCallback, useEffect, useRef, useState } from 'react'
import type { TerminalSessionInfo } from '../../shared/types'

/**
 * 终端会话列表与当前标签。
 *
 * 会话活在主进程，这里只做「有哪些、现在看哪个」：面板关掉再开、界面重载，
 * 都按主进程的 list() 接回原来的 shell，而不是重开一个。
 */
export function useTerminalSessions(onError: (message: string) => void) {
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  // 首次挂载时若一个会话都没有就自动开一个，但这只该发生一次，否则用户关掉最后一个标签又会被重新开出来
  const bootstrapped = useRef(false)

  const create = useCallback(async () => {
    try {
      const session = await window.fastAgent.terminal.create({})
      setSessions((current) => [...current, session])
      setActiveId(session.id)
    } catch (error) {
      onError(error instanceof Error ? error.message : '打开终端失败')
    }
  }, [onError])

  useEffect(() => {
    let cancelled = false
    void window.fastAgent.terminal.list().then(async (list) => {
      if (cancelled) return
      setSessions(list)
      setActiveId((current) => current && list.some((item) => item.id === current) ? current : list[0]?.id ?? null)
      setReady(true)
      if (!list.length && !bootstrapped.current) {
        bootstrapped.current = true
        await create()
      }
    }).catch(() => { if (!cancelled) { setReady(true); onError('读取终端会话失败') } })
    return () => { cancelled = true }
  }, [create, onError])

  useEffect(() => window.fastAgent.terminal.onExit(({ id }) => {
    setSessions((current) => current.filter((item) => item.id !== id))
    setActiveId((current) => current === id ? null : current)
  }), [])

  // 当前标签被关掉后落到还活着的第一个，避免面板停在空白上
  useEffect(() => {
    if (activeId || !sessions.length) return
    setActiveId(sessions[0].id)
  }, [activeId, sessions])

  const close = useCallback((id: string) => {
    void window.fastAgent.terminal.close(id).catch(() => onError('关闭终端失败'))
  }, [onError])

  return { sessions, activeId, ready, create, close, select: setActiveId }
}
