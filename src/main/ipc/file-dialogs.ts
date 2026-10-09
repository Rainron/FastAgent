import { dialog, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'

/** 导入导出通道共用的文件对话框：主窗口在时挂到窗口上，避免对话框跑到别的屏幕。 */
export async function saveToFile(window: BrowserWindow | null, defaultPath: string, data: Uint8Array | string, filters: Electron.FileFilter[]): Promise<string | null> {
  const options: Electron.SaveDialogOptions = { defaultPath, filters }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  writeFileSync(result.filePath, data)
  return result.filePath
}

export async function pickFile(window: BrowserWindow | null, filters: Electron.FileFilter[]): Promise<string | null> {
  const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters }
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
}

/** 文件名里的时间戳：冒号和点在 Windows 上不合法。 */
export function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}
