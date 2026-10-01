import type { AppSettings, SandboxSessionInfo } from '../../shared/types'
import { describeSession } from '../agent/sandbox/sandbox-events'
import { dialog } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 客户端偏好、应用设置与沙箱。 */
export function registerSettingsIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('preferences:get', () => ctx.store.getClientPreferences(ctx.preferenceNamespace()))
  handle('preferences:update', (_event, patch) => ctx.store.updateClientPreferences(ctx.preferenceNamespace(), patch))
  handle('settings:get', () => ctx.settings)
  handle('settings:update', (_event, patch: Partial<AppSettings>) => {
    return ctx.patchSettings(patch)
  })
  // Shell 偏好：弹系统文件选择器挑 bash.exe，选择后直接写入设置。
  // 默认打开 Git Bash 可能所在的目录，省得用户从「此电脑」一层层点进去。
  handle('settings:pick-bash', async () => {
    const options = {
      title: '选择 bash.exe',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'bash', extensions: ['exe'] }],
      defaultPath: ['ProgramFiles', 'ProgramFiles(x86)']
        .map((key) => process.env[key])
        .filter(Boolean)
        .flatMap((root) => [join(root!, 'Git', 'bin'), root!])
        .find((dir) => existsSync(dir))
    }
    const result = ctx.mainWindow ? await dialog.showOpenDialog(ctx.mainWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
  // Ctrl+G 外部编辑器：弹系统文件选择器挑编辑器可执行文件，选择后直接写入设置。
  handle('settings:pick-editor', async () => {
    const options = {
      title: '选择编辑器程序',
      properties: ['openFile'] as Array<'openFile'>,
      ...(process.platform === 'win32' ? { filters: [{ name: '可执行文件', extensions: ['exe'] }] } : {})
    }
    const result = ctx.mainWindow ? await dialog.showOpenDialog(ctx.mainWindow, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
  handle('sandbox:status', (_event, force = false) => ctx.sandboxManager.probe(Boolean(force)))
  handle('sandbox:initialize', () => ctx.sandboxManager.initialize())
  handle('sandbox:session-info', (): SandboxSessionInfo | null => {
    const session = ctx.sandboxManager.activeSession()
    return session ? describeSession(session) : null
  })
}
