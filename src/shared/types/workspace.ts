export interface WorkspaceFileContent {
  path: string
  absolutePath: string
  content: string
  lineCount: number
  truncated: boolean
}

export interface WorkspaceEntry {
  name: string
  /** 相对工作区根目录，统一用 / 分隔。 */
  path: string
  kind: 'dir' | 'file'
  /** 文件字节数；目录恒缺省。旧调用方不依赖它也能正常工作。 */
  size?: number
  /** 扩展名推断的文件类别（如 markdown / image），供文件树展示。 */
  fileType?: string
}

export interface WorkspaceListing {
  path: string
  entries: WorkspaceEntry[]
  truncated: boolean
  /** 目录已不存在（多为外部删除 / 切分支）；调用方据此收敛展开态，不是错误。 */
  missing?: boolean
}

export interface WorkspaceFileMatch {
  name: string
  /** 相对工作区根目录，统一用 / 分隔。 */
  path: string
  absolutePath: string
  size: number
  /** 目录候选：@ 补全同时支持文件与文件夹，目录没有可挂附件的内容。 */
  isDirectory?: boolean
}

/** Artifact 的持续查看价值分类；普通 Tool Call / Thinking / Chat Message 不登记。 */
export type ArtifactType = 'document' | 'markdown' | 'code' | 'patch' | 'diff' | 'plan' | 'report' | 'image' | 'html' | 'json' | 'csv' | 'log' | 'test-result' | 'build-result' | 'generated-file'

/** Agent / Chat 执行过程中产生、被主动登记的 Result。可关联工作区真实文件，也可只存在于 FastAgent 内部。 */
export interface Artifact {
  id: string
  /** 工作区根路径；与 Workspace 的 workspaceRoot 同义。 */
  workspaceId: string
  conversationId?: string
  taskId?: string
  agentRunId?: string
  /** 最近一次写入所属的会话轮；同一路径在一个会话里只有一条记录。 */
  turnId?: string
  name: string
  type: ArtifactType
  /** 相对工作区根目录的路径；无真实文件（纯内部产物）时缺省。 */
  path?: string
  /** 内部产物直接保存的内容摘要；不存真实文件全文。 */
  content?: string
  size?: number
  /** 登记来源，如工具名 / 会话标题。 */
  source?: string
  /** 文件已不在磁盘上（多为应用外删除 / 切分支）；列表时现算，不落库。 */
  missing?: boolean
  createdAt: number
  updatedAt: number
}

/** Artifacts 面板的查询条件：按工作区隔离，可按会话过滤与关键词检索。 */
export interface ArtifactQuery {
  workspaceId?: string
  conversationId?: string
  keyword?: string
  limit?: number
}

/** Artifacts 面板的树节点：组（任务/会话）与其下条目。 */
export interface ArtifactGroup {
  /** 组标识：conversationId，无归属时为 'ungrouped'。 */
  id: string
  /** 组名：任务名 → 会话标题 → 自动生成摘要标题；无归属时为 'Ungrouped'。 */
  name: string
  count: number
  artifacts: Artifact[]
}

export interface InitProjectResult {
  /** created：已写入 AGENTS.md；exists：项目已有 agent 记忆文件，未覆盖；error：无法执行（如未打开项目）。 */
  status: 'created' | 'exists' | 'error'
  path: string
  message?: string
}

export interface WorkspaceSnapshot {
  rootPath: string | null
  changes: Array<{ path: string; kind: 'M' | 'A' | 'D'; additions: number; deletions: number }>
}

/** 当前工作区的 Git 执行环境快照，null 表示非仓库或读取失败（UI 降级隐藏）。 */
export interface GitWorkspaceState {
  isGitRepository: boolean
  /** 当前分支名；detached HEAD 或空仓库无 HEAD 时为 null。 */
  branch: string | null
  detachedHead: boolean
  /** detached HEAD 时的短哈希，普通分支为 null。 */
  headShort: string | null
  changedFiles: number
  isDirty: boolean
}

/** git status --porcelain 的单个变更条目。 */
export interface GitStatusEntry {
  path: string
  /** XY 两字符状态码，如 ' M'、'M '、'??'。 */
  status: string
}

export interface GitOperationResult {
  ok: boolean
  error?: string
  /** 操作成功后的最新工作区状态；非仓库时为 null。 */
  state?: GitWorkspaceState | null
}

export interface ProjectRecord {
  id: string
  name: string
  path: string
  color: string
  archived: boolean
  createdAt: string
  updatedAt: string
  /** 添加项目时探测到的根目录 Agent 指令文件名；内容不持久化。 */
  agentContextFiles?: Array<'AGENTS.md' | 'CLAUDE.md'>
}
