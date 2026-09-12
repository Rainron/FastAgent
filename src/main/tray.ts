import { app, BrowserWindow, Menu, Tray } from 'electron'
import { trayIcon } from './app-icon'

let tray: Tray | null = null
let quitting = false
let closeToTray = true
let notifiedClose = false

export function setTrayClosePolicy(enabled: boolean) {
  closeToTray = enabled
}

export function setQuitting(value: boolean) {
  quitting = value
}

export function isQuitting() {
  return quitting
}

export function destroyTray() {
  tray?.destroy()
  tray = null
}

export function createTray(window: BrowserWindow, onNewConversation: () => void) {
  if (tray) return tray
  tray = new Tray(trayIcon())
  tray.setToolTip('FastAgent')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 FastAgent', click: () => showWindow(window) },
    { label: '新对话', click: onNewConversation },
    { type: 'separator' },
    { label: '退出 FastAgent', click: () => app.quit() }
  ]))
  tray.on('click', () => showWindow(window))
  return tray
}

export function showWindow(window: BrowserWindow) {
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}

/**
 * 快捷键触发的「收进托盘」：与关闭按钮同一行为，但不看 closeToTray——
 * 用户按的是「隐藏窗口」而不是「关闭」，即使关闭策略是退出也只隐藏。
 */
export function hideToTray(window: BrowserWindow) {
  if (!window.isVisible()) return false
  window.hide()
  if (!notifiedClose) {
    notifiedClose = true
    window.webContents.send('window:tray-hidden')
  }
  return true
}

export function handleWindowClose(event: Electron.Event, window: BrowserWindow) {
  if (quitting || !closeToTray) return
  event.preventDefault()
  window.hide()
  if (!notifiedClose) {
    notifiedClose = true
    window.webContents.send('window:tray-hidden')
  }
}

