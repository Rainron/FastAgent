import type { AppRuntimeInfo, RendererErrorReport, StartupWarnings } from '../../shared/types'
import { defaultDataRoot, writeDataRootLocator } from '../app-paths'
import type { AppPaths } from '../app-paths'
import { restartApplication } from '../app-restart'
import { settlePendingRequests } from '../approval-bridge'
import { moveManagedData } from '../data-directory'
import { hideToTray, setQuitting } from '../tray'
import { app, dialog, shell } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 应用信息、重启重载、窗口控制、托盘与数据目录。 */
export function registerAppWindowIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('app:info', (): AppRuntimeInfo => ctx.appRuntimeInfo())
  handle('app:restart', async () => {
    return restartApplication({
      confirm: () => ctx.confirmInterruptRuns('重启'),
      stop: ctx.stopActiveWork,
      markQuitting: () => setQuitting(true),
      relaunch: () => app.relaunch(),
      quit: () => app.quit()
    })
  })
  handle('app:reload', () => {
    if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) return false
    // 在 invoke 处理函数里同步销毁当前文档会和这次调用的回复抢时序，界面可能停在空白页，
    // 所以推到下一个 tick 再导航。
    setImmediate(() => {
      if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) return
      ctx.reloadRenderer()
    })
    return true
  })
  // 渲染进程报告首屏数据已备齐并绘制过一帧；主窗口在这之前一直是隐藏的。
  handle('startup:ready', () => { ctx.revealCoordinator?.markRendererReady() })
  handle('diagnostics:renderer-error', (_event, report: RendererErrorReport) => {
    ctx.reportCrash(
      'renderer-error',
      report.afterPaint ? '界面已渲染后发生' : '首屏渲染阶段发生',
      { message: report.message, stack: report.stack ?? null, componentStack: report.componentStack ?? null }
    )
  })
  handle('startup:warnings', (): StartupWarnings => ({
    warnings: [...ctx.startupWarnings],
    logPath: join(ctx.appPaths?.logsDir ?? app.getPath('logs'), 'startup.log')
  }))
  handle('window:minimize', () => { ctx.mainWindow?.minimize() })
  handle('window:toggle-maximize', () => {
    if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) return false
    if (ctx.mainWindow.isMaximized()) ctx.mainWindow.unmaximize()
    else ctx.mainWindow.maximize()
    return ctx.mainWindow.isMaximized()
  })
  // 走 close() 而不是 destroy()：关闭到托盘的策略挂在 'close' 事件上，绕过去会让设置失效。
  handle('window:close', () => { ctx.mainWindow?.close() })
  handle('window:is-maximized', () => Boolean(ctx.mainWindow && !ctx.mainWindow.isDestroyed() && ctx.mainWindow.isMaximized()))
  handle('app:hideToTray', () => {
    if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) return false
    return hideToTray(ctx.mainWindow)
  })
  handle('app:quit', async () => {
    if (!await ctx.confirmInterruptRuns('退出')) return false
    ctx.stopActiveWork()
    // 绕开「关闭到托盘」，这里是用户显式要求彻底退出。
    setQuitting(true)
    app.quit()
    return true
  })
  handle('storage:info', () => ({
    dataRoot: ctx.appPaths.dataRoot,
    databasePath: ctx.appPaths.databasePath,
    cacheDir: ctx.appPaths.cacheDir,
    logsDir: ctx.appPaths.logsDir,
    tempDir: ctx.appPaths.tempDir,
    sessionsDir: ctx.appPaths.sessionsDir,
    agentDir: ctx.appPaths.agentDir,
    skillsDir: ctx.appPaths.skillsDir,
    mcpDir: ctx.appPaths.mcpDir,
    pluginsDir: ctx.appPaths.pluginsDir,
    attachmentsDir: ctx.appPaths.attachmentsDir,
    backupsDir: ctx.appPaths.backupsDir,
    exportsDir: ctx.appPaths.exportsDir,
    defaultRoot: defaultDataRoot(homedir()),
    isDefault: ctx.appPaths.dataRoot === defaultDataRoot(homedir())
  }))
  handle('storage:open-data-directory', () => shell.openPath(ctx.appPaths.dataRoot))
  handle('storage:open-path', (_event, key: string) => {
    const allowed = new Set(['dataRoot', 'databasePath', 'sessionsDir', 'agentDir', 'skillsDir', 'mcpDir', 'pluginsDir', 'attachmentsDir', 'backupsDir', 'exportsDir', 'cacheDir', 'logsDir', 'tempDir'])
    if (!allowed.has(key)) return '不允许打开该路径'
    return shell.openPath(ctx.appPaths[key as keyof AppPaths] as string)
  })
  handle('storage:move-data-directory', async () => {
    const result = ctx.mainWindow
      ? await dialog.showOpenDialog(ctx.mainWindow, { title: '选择新的 FastAgent 数据目录', properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ title: '选择新的 FastAgent 数据目录', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return { moved: false, cancelled: true }
    const targetRoot = result.filePaths[0]
    if (targetRoot === ctx.appPaths.dataRoot) return { moved: false }
    for (const run of ctx.activeRuns.values()) run.controller.abort()
    ctx.activeRuns.clear()
    settlePendingRequests(new DOMException('数据目录正在迁移', 'AbortError'))
    ctx.store.close()
    try {
      moveManagedData(ctx.appPaths.dataRoot, targetRoot)
      writeDataRootLocator(ctx.appPaths.platformUserDataDir, targetRoot)
      app.relaunch()
      app.exit(0)
      return { moved: true }
    } catch (error) {
      ctx.reopenStore()
      throw error
    }
  })
}
