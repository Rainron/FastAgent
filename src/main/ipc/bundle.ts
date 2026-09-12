import { dialog, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { createBundleService, BundleExportOptions, BundleImportPlan } from '../bundle/bundle-service'
import { bundleNeedsPassphrase } from '../bundle/ability-bundle'
import type { IpcRegistrar } from './hub'

export interface BundleIpcDeps {
  bundles: ReturnType<typeof createBundleService>
  mainWindow(): BrowserWindow | null
  /** 导出对话框的默认落地目录。用取值函数而不是按值捕获：数据目录是可变的模块级单例。 */
  exportsDir(): string
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export function registerBundleIpc(handle: IpcRegistrar, deps: BundleIpcDeps) {
  async function saveArchive(defaultName: string, data: Uint8Array, filters: Electron.FileFilter[]) {
    const window = deps.mainWindow()
    const options: Electron.SaveDialogOptions = { defaultPath: join(deps.exportsDir(), defaultName), filters }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, data)
    return result.filePath
  }

  async function pickArchive(filters: Electron.FileFilter[]) {
    const window = deps.mainWindow()
    const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  }

  handle('bundle:export', async (_event, options: BundleExportOptions) =>
    saveArchive(`fastagent-abilities-${stamp()}.fabundle`, deps.bundles.exportBundle(options), [{ name: 'FastAgent 能力整包', extensions: ['fabundle'] }]))

  handle('bundle:export-skill', async (_event, name: string) =>
    saveArchive(`${name}.zip`, deps.bundles.exportSkill(name), [{ name: 'Skill 压缩包', extensions: ['zip'] }]))

  /** 选包 + 解析。加密包未给口令时先回 needsPassphrase，由界面追问后再调一次。 */
  handle('bundle:preview', async (_event, passphrase?: string) => {
    const path = await pickArchive([{ name: 'FastAgent 能力整包', extensions: ['fabundle', 'zip'] }])
    if (!path) return null
    const archive = new Uint8Array(readFileSync(path))
    if (!passphrase && bundleNeedsPassphrase(archive)) return { path, needsPassphrase: true, contents: null }
    return { path, needsPassphrase: false, contents: deps.bundles.preview(archive, passphrase) }
  })

  handle('bundle:preview-path', (_event, path: string, passphrase?: string) => {
    const archive = new Uint8Array(readFileSync(path))
    if (!passphrase && bundleNeedsPassphrase(archive)) return { path, needsPassphrase: true, contents: null }
    return { path, needsPassphrase: false, contents: deps.bundles.preview(archive, passphrase) }
  })

  handle('bundle:import', (_event, path: string, plan: BundleImportPlan) =>
    deps.bundles.importBundle(new Uint8Array(readFileSync(path)), plan))
}
