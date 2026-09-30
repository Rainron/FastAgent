/** 项目知识库条目：人工策展的项目背景/约定，检索后注入 prompt 前缀。 */
export interface KbEntry {
  id: string
  projectId: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  /** 来自文件/目录导入时指向所属来源；手工条目为 null。 */
  sourceId?: string | null
  /** 条目在来源里的文件路径（相对来源根目录）；手工条目为 null。 */
  sourcePath?: string | null
  /** 原文定位：文本用 L12-48，PDF 用 p.3；手工条目为 null。 */
  locator?: string | null
}

/** 单文件绑定与目录绑定；手工条目不属于任何来源。 */
export type KbSourceKind = 'file' | 'directory'

/** indexing 只在导入进行中出现；stale 表示磁盘上已找不到来源，检索不再返回它的条目。 */
export type KbSourceStatus = 'indexing' | 'indexed' | 'failed' | 'stale'

export interface KbSource {
  id: string
  projectId: string
  kind: KbSourceKind
  /** 绑定的绝对路径。 */
  path: string
  title: string
  status: KbSourceStatus
  /** 失败原因原文；成功时为 null。 */
  error: string | null
  /** 已索引的文件数与条目数，供界面说明索引结果。 */
  fileCount: number
  entryCount: number
  /** 目录绑定的排除规则；单文件为空数组。 */
  excludes: string[]
  /** 每次重新索引递增，用于说明「引用的是第几版内容」。 */
  version: number
  createdAt: number
  updatedAt: number
}

/** 导入前的范围预览：让用户在真正写库之前看清会索引什么。 */
export interface KbSourcePreview {
  path: string
  kind: KbSourceKind
  files: Array<{ path: string; size: number; kind: 'markdown' | 'text' | 'pdf' }>
  skipped: Array<{ reason: string; label: string; count: number }>
  truncated: boolean
}

/** 一次索引/重新索引的结果。 */
export interface KbIndexResult {
  source: KbSource
  indexedFiles: number
  /** 内容未变、直接跳过的文件数。 */
  unchangedFiles: number
  removedFiles: number
  entryCount: number
  /** 逐个文件的失败原因；整体失败时 source.status 为 failed。 */
  failures: Array<{ path: string; error: string }>
}
