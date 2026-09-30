/** 统一搜索覆盖的四类内容。会话正文不在范围内：整段历史逐轮反序列化会把主进程顶死。 */
export type SearchResultKind = 'conversation' | 'knowledge' | 'skill' | 'artifact'

export interface SearchResult {
  kind: SearchResultKind
  /** 会话 id / 知识条目 id / Skill 名 / 产物 id。 */
  id: string
  title: string
  /** 一行摘要；没有可摘的内容时为空串。 */
  snippet: string
  /** 归属项目；Skill 与未归属会话为 null。 */
  projectId: string | null
  /** 定位到原始位置：知识条目的「文件 行区间」、产物的工作区相对路径。 */
  locator: string | null
  /** 产物打开预览需要工作区根路径。 */
  workspaceId?: string
  updatedAt: number
}

export interface SearchQuery {
  keyword: string
  /** 不传表示四类全查。 */
  kinds?: SearchResultKind[]
  /** 传 null 表示不按项目过滤；传具体 id 时只看该项目（Skill 是全局的，按项目过滤时不参与）。 */
  projectId?: string | null
  /** 每一类的条数上限。 */
  limit?: number
}

export interface SearchResponse {
  results: SearchResult[]
  /** 某一类命中数达到上限被截断；界面要如实告知「还有更多」。 */
  truncated: boolean
}
