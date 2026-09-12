/** Agent 对单个文件做的事；read 不入账，Bar 只关心「改了什么」。 */
export type FileOperation = 'create' | 'update' | 'delete' | 'rename'

/** 一轮里某个文件的最终变更状态；同一路径多次操作聚合成一条。 */
export interface AgentFileChange {
  path: string
  operation: FileOperation
  /** 重命名前的路径。 */
  oldPath?: string
  additions: number
  deletions: number
  /** 触发变更的工具名，按首次出现顺序去重。 */
  tools: string[]
  /** 有无可展示的逐行 diff；文本按需单独取，不随列表一起传。 */
  hasDiff: boolean
  updatedAt: number
}

/** Bar 订阅的聚合状态：一轮一份，UI 不碰底层工具调用。 */
export interface AgentRunChanges {
  turnId: string
  changedFiles: number
  addedFiles: number
  modifiedFiles: number
  deletedFiles: number
  renamedFiles: number
  additions: number
  deletions: number
  files: AgentFileChange[]
}
