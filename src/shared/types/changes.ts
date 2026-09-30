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
/**
 * 一个成果文件的一次改动记录，等价于「一个回合改了它一次」。
 * 版本号不单独维护：回合本身就是可追溯的版本标识，另起一套编号只会多一处要对齐的真相。
 */
export interface FileVersionRecord {
  turnId: string
  runId: string
  conversationId: string
  operation: FileOperation
  additions: number
  deletions: number
  /** 有逐行 diff 可看；二进制与超大文件为 false。 */
  hasDiff: boolean
  /** 存过改动前原文，可恢复；旧记录与超限文件为 false。 */
  canRestore: boolean
  changedAt: number
}

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
