/**
 * 启动页窗口：承接主窗口显示之前的空窗期。
 *
 * 单独开窗而不是在主界面里画启动屏，是因为主界面本身就是要等的那一段——
 * 渲染进程还没挂载时它画不出任何东西。这个窗口只加载一份内联好的静态 HTML，
 * 主进程随后做同步初始化把自己阻塞住时，它在自己的渲染进程里照样动。
 */
import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import type { SplashUpdate } from '../shared/types'

const CANVAS = { light: '#fafaf8', dark: '#181817' } as const

/** 与 body 的 opacity transition 对齐；淡出没走完就销毁会看到窗口直接消失。 */
const FADE_OUT_MS = 220

let splashWindow: BrowserWindow | null = null
let loaded = false
/**
 * 最近一次状态与主题各自留存：主进程在 store 初始化阶段是同步阻塞的，
 * 首条更新必然早于页面加载完成，页面就绪后要能把当前状态补上。
 */
let lastUpdate: SplashUpdate | null = null
let currentTheme: 'light' | 'dark' | undefined
let dismissTimer: ReturnType<typeof setTimeout> | null = null

function alive(): boolean {
  return Boolean(splashWindow && !splashWindow.isDestroyed())
}

function flush() {
  if (!alive() || !loaded || !lastUpdate) return
  ;(splashWindow as BrowserWindow).webContents.send('splash:update', { ...lastUpdate, theme: currentTheme })
}

export function createSplashWindow(): void {
  if (alive()) return
  loaded = false
  lastUpdate = null
  currentTheme = undefined
  const win = new BrowserWindow({
    width: 360,
    height: 200,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // 不进任务栏、不抢焦点：主窗口 show() 时直接拿到焦点，启动页只是覆在上面淡出。
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    // 此刻还没读到设置，先按系统主题定底色，读到设置后由 showSplashWindow 校正。
    backgroundColor: nativeTheme.shouldUseDarkColors ? CANVAS.dark : CANVAS.light,
    webPreferences: {
      preload: join(__dirname, '../preload/splash.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.webContents.on('did-finish-load', () => { loaded = true; flush() })
  win.on('closed', () => { if (splashWindow === win) splashWindow = null })
  const load = process.env.ELECTRON_RENDERER_URL
    ? win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/splash.html`)
    : win.loadFile(join(__dirname, '../renderer/splash.html'))
  // 启动页自己加载失败不能反过来影响启动：主窗口该显示还是显示。
  load.catch((error) => console.error('[splash] 加载失败:', error))
  splashWindow = win
}

export function updateSplashWindow(update: SplashUpdate): void {
  lastUpdate = update
  flush()
}

/** 读到设置之后才显示：主题在这之前是猜的，显示后再改会当着用户的面闪一下。 */
export function showSplashWindow(theme: 'light' | 'dark'): void {
  if (!alive()) return
  const win = splashWindow as BrowserWindow
  currentTheme = theme
  win.setBackgroundColor(CANVAS[theme])
  flush()
  win.showInactive()
}

/** 主窗口已显示：走淡出再销毁，和主界面的淡入构成交叉过渡。 */
export function dismissSplashWindow(): void {
  if (!alive() || dismissTimer) return
  updateSplashWindow({ phase: 'ready', label: 'Ready', verbosity: lastUpdate?.verbosity ?? 'minimal' })
  dismissTimer = setTimeout(() => {
    dismissTimer = null
    destroySplashWindow()
  }, FADE_OUT_MS)
}

/** 不淡出直接收掉：启动时就要隐藏到托盘、或启动页根本不该出现的场景。 */
export function destroySplashWindow(): void {
  if (dismissTimer) {
    clearTimeout(dismissTimer)
    dismissTimer = null
  }
  if (!alive()) {
    splashWindow = null
    return
  }
  ;(splashWindow as BrowserWindow).destroy()
  splashWindow = null
}
