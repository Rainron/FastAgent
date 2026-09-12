import { useCallback, useEffect, useRef, useState } from 'react'
import { loadResourcePanelState, saveResourcePanelState, updateTabState, type ResourcePanelState, type ResourceTabKey, type ResourceTabState } from './panel-state'

/** 300ms 防抖落盘：展开/滚动这类高频变化不逐次写 localStorage。 */
const SAVE_DEBOUNCE_MS = 300

export function useResourcePanelState() {
  const [panelState, setPanelState] = useState<ResourcePanelState>(loadResourcePanelState)
  const saveTimer = useRef<number | null>(null)

  // 面板整体变化（宽度、切 Tab）与子状态变化共用同一套防抖保存；
  // 卸载时兜底落盘一次，避免最后一次变化丢在 300ms 窗口里。
  useEffect(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveResourcePanelState(panelState), SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      saveResourcePanelState(panelState)
    }
  }, [panelState])

  const updateTab = useCallback((tab: ResourceTabKey, patch: Partial<ResourceTabState>) => {
    setPanelState((current) => updateTabState(current, tab, patch))
  }, [])

  const updatePanel = useCallback((patch: Partial<Pick<ResourcePanelState, 'activeTab' | 'width'>>) => {
    setPanelState((current) => ({ ...current, ...patch }))
  }, [])

  return { panelState, updateTab, updatePanel }
}
