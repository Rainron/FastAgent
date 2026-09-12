import { createContext, useContext } from 'react'
import type { FileReference } from './file-reference'

export interface ResponseActions {
  /** 打开工作区文件并跳到行号；由外层接到产物面板上。 */
  openFile: (reference: FileReference) => void
  copyText: (text: string) => void
  notify: (message: string) => void
}

const fallback: ResponseActions = { openFile: () => undefined, copyText: () => undefined, notify: () => undefined }

export const ResponseActionsContext = createContext<ResponseActions>(fallback)

export function useResponseActions(): ResponseActions {
  return useContext(ResponseActionsContext)
}

/** 外链统一走主进程 shell.openExternal，主进程只放行 http/https。 */
export async function openExternalLink(url: string, notify: (message: string) => void) {
  const error = await window.fastAgent.shell.openExternal(url).catch(() => '打开链接失败')
  if (error) notify(error)
}
