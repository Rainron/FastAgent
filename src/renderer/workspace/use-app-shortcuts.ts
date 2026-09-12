import { useEffect } from 'react'
import type { InAppShortcutAction, ShortcutSettings } from '../../shared/types'
import { COMPOSER_SCOPED_ACTIONS, DEFAULT_IN_APP_BINDINGS, matchKeyboardBinding, matchMouseBinding } from '../shortcuts'
import { useEventCallback } from '../use-event-callback'

export interface AppShortcutHandlers {
  newConversation: () => void
  openSettings: () => void
  toggleTheme: () => void
  notify: (notice: string) => void
  /** 鼠标侧键的历史前进/后退；direction -1 为后退。 */
  stepHistory: (direction: -1 | 1) => void
}

/**
 * 应用内快捷键：窗口层统一监听，命中用户绑定时派发动作；
 * commandPalette 由 Composer 监听 CustomEvent 响应，其余在这里直接执行；
 * COMPOSER_SCOPED_ACTIONS 里的动作不走这里，由 Composer 自己的 keydown 处理。
 *
 * 处理器经 useEventCallback 定住引用，效应只在绑定变化时重建；
 * 原先没有依赖数组，流式输出期间每帧都要卸载再挂一遍全部 window 监听。
 */
export function useAppShortcuts(shortcuts: ShortcutSettings | undefined, handlers: AppShortcutHandlers) {
  const runAction = useEventCallback((action: InAppShortcutAction) => {
    if (action === 'newConversation') handlers.newConversation()
    else if (action === 'openSettings') handlers.openSettings()
    else if (action === 'hideToTray') void window.fastAgent.app.hideToTray()
    else if (action === 'reloadWindow') void window.fastAgent.app.reload()
    // 重启与退出在主进程侧还有一次「有任务运行」的确认框，取消时回落成提示。
    else if (action === 'restartApp') void window.fastAgent.app.restart().then((done) => { if (!done) handlers.notify('已取消重启') })
    else if (action === 'quitApp') void window.fastAgent.app.quit().then((done) => { if (!done) handlers.notify('已取消退出') })
    else if (action === 'toggleTheme') handlers.toggleTheme()
    else window.dispatchEvent(new CustomEvent('fastagent:shortcut', { detail: action }))
  })

  useEffect(() => {
    const bindingsOf = () => shortcuts?.inApp ?? DEFAULT_IN_APP_BINDINGS
    const onKeyDown = (event: KeyboardEvent) => {
      // 从未自定义过时保留历史默认（Ctrl+K），一旦存过 shortcuts 就完全以存储值为准
      for (const [action, binding] of Object.entries(bindingsOf())) {
        if (COMPOSER_SCOPED_ACTIONS.includes(action as InAppShortcutAction)) continue
        if (binding && binding.type === 'key' && matchKeyboardBinding(event, binding)) {
          event.preventDefault()
          runAction(action as InAppShortcutAction)
          return
        }
      }
    }
    const onMouseDown = (event: MouseEvent) => {
      for (const [action, binding] of Object.entries(bindingsOf())) {
        if (COMPOSER_SCOPED_ACTIONS.includes(action as InAppShortcutAction)) continue
        if (binding && binding.type === 'mouse' && matchMouseBinding(event, binding)) {
          // 中键/侧键的默认行为（自动滚动、历史导航）与动作冲突，命中时一律拦截
          event.preventDefault()
          runAction(action as InAppShortcutAction)
          return
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onMouseDown)
    }
  }, [shortcuts, runAction])

  // 鼠标侧键（X1=3 后退、X2=4 前进）。mousedown 上拦截默认动作，避免 Chromium 拿去做 webContents 级导航把整个 SPA 刷掉。
  const stepHistory = useEventCallback(handlers.stepHistory)
  useEffect(() => {
    const isSideButton = (button: number) => button === 3 || button === 4
    const onDown = (event: MouseEvent) => { if (isSideButton(event.button)) event.preventDefault() }
    const onUp = (event: MouseEvent) => {
      if (!isSideButton(event.button)) return
      event.preventDefault()
      stepHistory(event.button === 3 ? -1 : 1)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('auxclick', onDown)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('auxclick', onDown)
    }
  }, [stepHistory])
}
