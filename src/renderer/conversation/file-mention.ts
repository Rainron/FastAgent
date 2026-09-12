// 输入框 @ / 补全的纯逻辑：只处理文本与数据过滤，不碰 DOM 与 IPC。

/** @ 触发工作区文件补全；/ 触发 skill 补全。 */
export type MentionTrigger = '@' | '/'

export interface MentionQuery {
  trigger: MentionTrigger
  /** 触发符在文本中的下标 */
  start: number
  /** 触发符之后已经输入的内容 */
  query: string
}

// 触发符前必须是行首或空白，否则 `a@b.com`、`user@host`、URL 里的斜杠也会把补全弹出来。
const AT_MENTION = /(?:^|\s)@([^\s@]*)$/
// 查询段排除 /：输入路径（/usr/bin）时中途不应反复触发。
const SLASH_MENTION = /(?:^|\s)\/([^\s/]*)$/

export function activeMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret)
  const at = AT_MENTION.exec(before)
  if (at) return { trigger: '@', start: caret - at[1].length - 1, query: at[1] }
  const slash = SLASH_MENTION.exec(before)
  if (slash) return { trigger: '/', start: caret - slash[1].length - 1, query: slash[1] }
  return null
}

/** 选中候选后替换掉 `触发符 query` 片段；补一个空格，接着打字不会又触发补全。
 * @ 与 / 都只是唤起菜单的触发符，插入的内容不带前缀（内置命令除外，见 applySlashCommand）。 */
export function applyMention(text: string, mention: MentionQuery, value: string): { text: string; caret: number } {
  return replaceMentionFragment(text, mention, `${value} `)
}

/** 内置命令插入时保留斜杠前缀，submit 才能识别拦截。 */
export function applySlashCommand(text: string, mention: MentionQuery, name: string): { text: string; caret: number } {
  return replaceMentionFragment(text, mention, `/${name} `)
}

function replaceMentionFragment(text: string, mention: MentionQuery, inserted: string): { text: string; caret: number } {
  const end = mention.start + 1 + mention.query.length
  return {
    text: `${text.slice(0, mention.start)}${inserted}${text.slice(end)}`,
    caret: mention.start + inserted.length
  }
}

export interface SkillCandidate {
  name: string
  description: string
  enabled: boolean
  kind?: 'skill' | 'cli'
}

// 与 main/workspace-files 的 matchesFuzzy 同一套子序列匹配；跨 main/renderer 不能直接 import。
function matchesFuzzy(candidate: string, query: string): boolean {
  if (!query) return true
  const haystack = candidate.toLowerCase()
  let index = 0
  for (const char of query.toLowerCase()) {
    const found = haystack.indexOf(char, index)
    if (found < 0) return false
    index = found + 1
  }
  return true
}

/** / 补全的 skill 过滤：只留已启用的，名称或描述子序列命中即可。 */
export function filterSkills(records: SkillCandidate[], query: string, limit = 20): SkillCandidate[] {
  const keyword = query.trim()
  return records
    .filter((record) => record.enabled && (matchesFuzzy(record.name, keyword) || matchesFuzzy(record.description, keyword)))
    .slice(0, limit)
}

/** 内置斜杠命令：与 skill 共用 / 菜单，提交时由 Composer 拦截执行，不进对话。 */
export interface SlashCommand {
  name: string
  description: string
  kind?: 'command'
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'pass', description: '切换/退出完全访问权限，执行不再询问' },
  { name: 'new', description: '新建对话，离开当前会话' },
  { name: 'resume', description: '选择并恢复一个最近的会话' },
  { name: 'clear', description: '清空当前会话的全部消息与上下文' },
  { name: 'init', description: '在当前项目根目录生成 AGENTS.md' },
  { name: 'compact', description: '压缩当前会话的较早上下文' },
  { name: 'help', description: '查看可用斜杠命令' }
]

/** 斜杠命令按名称前缀匹配：命令少且名字固定，前缀比子序列更符合直觉。 */
export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const keyword = query.trim().toLowerCase()
  return commands.filter((command) => !keyword || command.name.startsWith(keyword))
}
