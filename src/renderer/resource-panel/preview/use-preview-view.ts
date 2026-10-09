import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PREVIEW_VIEW, normalizePreviewView, type PreviewViewState } from './preview-layout'

const PREVIEW_VIEW_KEY = 'fastagent.preview-view.v1'

function loadPreviewView(): PreviewViewState {
  try {
    const raw = window.localStorage.getItem(PREVIEW_VIEW_KEY)
    return raw ? normalizePreviewView(JSON.parse(raw)) : DEFAULT_PREVIEW_VIEW
  } catch {
    return DEFAULT_PREVIEW_VIEW
  }
}

/** 设备与缩放是全局偏好：和面板宽度一样记住，换一个预览不用重新调。 */
export function usePreviewView() {
  const [view, setView] = useState<PreviewViewState>(loadPreviewView)

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_VIEW_KEY, JSON.stringify(view))
    } catch {
      // 存储满 / 被禁用时静默失败，不影响预览本身。
    }
  }, [view])

  const updateView = useCallback((patch: Partial<PreviewViewState>) => setView((current) => normalizePreviewView({ ...current, ...patch })), [])
  return { view, updateView }
}
