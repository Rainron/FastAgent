import type { Ability, KbEntry, TurnContextSource } from '../../shared/types'
import type { AgentContextFile } from '../agent-context'

/** 落库的一条来源；recordedAt 由存储层统一打时间戳。 */
export type ContextSourceInput = Omit<TurnContextSource, 'recordedAt'>

/** 摘要长度：来源面板只需要一眼认出是哪条，不承担阅读原文的职责。 */
const DETAIL_CHARS = 120

function summarize(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > DETAIL_CHARS ? `${flat.slice(0, DETAIL_CHARS)}…` : flat
}

/**
 * 知识条目：真正被检索命中并拼进 prompt 的那几条，不是项目里的全部条目。
 * 来自文件导入的条目带原文位置，摘要前先标出来，界面上才能对上引用。
 */
export function kbContextSources(entries: readonly KbEntry[]): ContextSourceInput[] {
  return entries.map((entry) => {
    const citation = entry.sourcePath ? `${entry.sourcePath}${entry.locator ? ` ${entry.locator}` : ''} · ` : ''
    return {
      kind: 'kb' as const,
      refId: entry.id,
      title: entry.title,
      locator: null,
      detail: `${citation}${summarize(entry.content)}`
    }
  })
}

/**
 * Skill：pi 只把名称与描述注入系统提示，正文由模型自己按需读。
 * 因此这里记的是「本轮可被选中的 Skill」，detail 必须说清这一点，
 * 不能让界面读成「这一轮执行了这个 Skill」。
 */
export function skillContextSources(abilities: readonly Ability[], revisions: ReadonlyMap<string, number> = new Map()): ContextSourceInput[] {
  return abilities
    .filter((ability) => ability.type === 'skill' && ability.enabled)
    .map((ability) => {
      // 修订号把「这一轮用的是哪一版」钉死：之后编辑或回退 Skill 都不影响这条记录的含义。
      const revision = revisions.get(ability.id)
      const marks = [ability.version ? `v${ability.version}` : '', revision ? `rev${revision}` : ''].filter(Boolean)
      return {
        kind: 'skill' as const,
        refId: ability.id,
        title: ability.displayName || ability.name,
        locator: ability.localPath ?? null,
        detail: `${marks.length ? `${marks.join(' · ')} · ` : ''}描述已注入，正文按需读取`
      }
    })
}

/** 项目规则：AGENTS.md / CLAUDE.md 整份进系统提示，截断时如实标注。 */
export function ruleContextSources(files: readonly AgentContextFile[]): ContextSourceInput[] {
  return files.map((file) => ({
    kind: 'rule' as const,
    refId: file.path,
    title: `${file.source === 'project' ? '项目' : '全局'} ${file.name}`,
    locator: file.path,
    detail: file.truncated ? '整份注入（已按长度上限截断）' : '整份注入'
  }))
}

export function buildTurnContextSources(input: {
  kbEntries?: readonly KbEntry[]
  abilities?: readonly Ability[]
  ruleFiles?: readonly AgentContextFile[]
  /** Skill 名 → 当前修订号，用于把本轮绑定到确定的一版。 */
  skillRevisions?: ReadonlyMap<string, number>
}): ContextSourceInput[] {
  return [
    ...kbContextSources(input.kbEntries ?? []),
    ...skillContextSources(input.abilities ?? [], input.skillRevisions),
    ...ruleContextSources(input.ruleFiles ?? [])
  ]
}
