/**
 * 快速对话窗口：连按两次 Ctrl 唤起的轻量对话框。
 *
 * 与主窗口共用同一个 renderer（?window=quick 分流到 QuickChat 组件），
 * 首次唤起时创建、之后复用；失焦即隐藏，保持常驻以获得最快的再次唤起速度。
 */
import { BrowserWindow } from 'electron'
import { join } from 'node:path'

let quickWindow: BrowserWindow | null = null

function createQuickWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 540,
    minWidth: 480,
    minHeight: 360,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    resizable: true,
    title: '快速对话',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setAlwaysOnTop(true, 'floating')
  // 失焦即隐藏：快速对话的定位是「问完就走」，不占用任务栏与焦点管理
  win.on('blur', () => { if (win.isVisible()) win.hide() })
  win.on('closed', () => { if (quickWindow === win) quickWindow = null })
  // 阻止窗口内导航：链接一律走主窗口的既有规则，这里直接不给开
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  const load = process.env.ELECTRON_RENDERER_URL
    ? win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?window=quick`)
    : win.loadFile(join(__dirname, '../renderer/index.html'), { search: 'window=quick' })
  load.catch((error) => console.error('[quick-window] 加载失败:', error))
  return win
}

function isQuickWindow(win: BrowserWindow | null): boolean {
  return Boolean(win && !win.isDestroyed())
}

/** 唤起快速对话：已存在则直接显示并聚焦；隐藏状态下从托盘态恢复。 */
export function showQuickWindow(): void {
  if (!isQuickWindow(quickWindow)) quickWindow = createQuickWindow()
  const win = quickWindow as BrowserWindow
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function hideQuickWindow(): void {
  if (isQuickWindow(quickWindow)) (quickWindow as BrowserWindow).hide()
}

/** chat 事件需要同时投递给快速对话窗口，否则小窗里看不到流式回答。 */
export function sendQuickWindowEvent(channel: string, payload: unknown): void {
  if (isQuickWindow(quickWindow)) (quickWindow as BrowserWindow).webContents.send(channel, payload)
}

export function quickWindowExists(): boolean {
  return isQuickWindow(quickWindow)
}
