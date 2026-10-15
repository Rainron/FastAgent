import { useEffect, useRef, useState } from 'react'
import { parseIpcError } from '../ipc-error'
import { useEventCallback } from '../use-event-callback'

export function useOpenLocalFile(path: string, workspaceRoot: string | null, onNotice: (notice: string) => void) {
  const [opening, setOpening] = useState(false)
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const current = useRef({ path, workspaceRoot })
  current.current = { path, workspaceRoot }
  const open = useEventCallback(async () => {
    if (busy.current || !workspaceRoot) return
    const target = current.current
    busy.current = true
    setOpening(true)
    try {
      const failure = await window.fastAgent.workspace.openExternal(target.path, workspaceRoot)
      if (mounted.current && failure && current.current.path === target.path && current.current.workspaceRoot === target.workspaceRoot) onNotice(`打开文件失败：${failure}`)
    } catch (cause) {
      if (mounted.current && current.current.path === target.path && current.current.workspaceRoot === target.workspaceRoot) onNotice(parseIpcError(cause, '打开文件失败').message)
    } finally {
      busy.current = false
      if (mounted.current) setOpening(false)
    }
  })
  return { opening, open, disabled: opening || !workspaceRoot }
}
