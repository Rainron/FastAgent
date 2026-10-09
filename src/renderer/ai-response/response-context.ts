import { createContext, useContext } from 'react'
import type { Attachment } from '../../shared/types'
import type { FileReference } from './file-reference'

export interface ResponseActions {
  /** 打开工作区文件并跳到行号；由外层接到产物面板上。 */
  openFile: (reference: FileReference) => void
  /** 在右侧面板预览消息里的附件；与资源面板互斥。 */
  openAttachment: (attachment: Attachment) => void
  copyText: (text: string) => void
  notify: (message: string) => void
  /** 跳到「能力」页并展开该 Skill 的详情；回合内的来源清单只留标题，正文去那边看。 */
  openSkill: (abilityId: string) => void
}

const fallback: ResponseActions = { openFile: () => undefined, openAttachment: () => undefined, copyText: () => undefined, notify: () => undefined, openSkill: () => undefined }

export const ResponseActionsContext = createContext<ResponseActions>(fallback)

export function useResponseActions(): ResponseActions {
  return useContext(ResponseActionsContext)
}

/** 外链统一走主进程 shell.openExternal，主进程只放行 http/https。 */
export async function openExternalLink(url: string, notify: (message: string) => void) {
  const error = await window.fastAgent.shell.openExternal(url).catch(() => '打开链接失败')
  if (error) notify(error)
}
