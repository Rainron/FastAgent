import { containsSecretLike } from '../memory/memory-extractor'

/**
 * 技能蒸馏：把一段已完成的会话提炼成可复用的 SKILL.md 草稿。
 * 触发由用户发起（会话操作菜单），不走自动信号——误报会把草稿垃圾塞进注册表。
 * 模型只出草稿，落库前用户在界面里可改可弃。
 */

/** 送进蒸馏提示的回合上限：太久远的回合与「这次做对了什么」基本无关。 */
export const MAX_DISTILL_TURNS = 12
const MAX_TURN_CHARACTERS = 2_000
const MAX_INSTRUCTIONS_CHARACTERS = 8_000

export interface DistillTurn {
  user: string
  assistant: string | null
}

export interface SkillDraft {
  name: string
  description: string
  instructions: string
}

export interface DistillSource {
  title: string
  turns: readonly DistillTurn[]
}

export function buildDistillPrompt(source: DistillSource): string {
  const turns = source.turns.slice(-MAX_DISTILL_TURNS)
  const transcript = turns
    .map((turn, index) => {
      const user = turn.user.slice(0, MAX_TURN_CHARACTERS)
      const assistant = (turn.assistant ?? '').slice(0, MAX_TURN_CHARACTERS)
      return `【回合 ${index + 1}】\n用户：${user}\n助手：${assistant}`
    })
    .join('\n\n')
  return `你在为编码助手蒸馏技能（skill）。下面是一段已完成的会话，请从中提炼出「下次遇到同类任务时直接可复用的操作方法」。

要求：
- 提炼的是流程、约定、检查清单或踩坑经验，不是这段对话本身的内容摘要。
- 如果这轮对话没有可提炼的方法论（比如纯问答、闲聊、一次性配置），只输出一行 NONE。
- 指令写成给未来助手看的操作指南：步骤化、祈使句、包含关键命令或路径模式。

输出格式（严格遵守，name 用小写字母、数字和连字符）：
---
name: kebab-case-name
description: 一句话说明什么时候用这个技能（单行，120 字以内）
---

（markdown 指令正文，${MAX_INSTRUCTIONS_CHARACTERS} 字以内）

会话标题：${source.title.slice(0, 200)}

会话记录：
${transcript}`
}

/**
 * 容错解析：只认得出 frontmatter 块才返回草稿，字段非法一律返回 null 让调用方报错，
 * 不做「尽力修复」——模型输出的名字格式错，人改一次比静默截断可靠。
 */
export function parseSkillDraft(text: string): SkillDraft | null {
  const matched = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.trim())
  if (!matched) return null
  const name = /^name:\s*(.+)$/m.exec(matched[1])?.[1]?.trim() ?? ''
  const description = /^description:\s*(.+)$/m.exec(matched[1])?.[1]?.trim() ?? ''
  const instructions = matched[2].trim()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) return null
  if (!description || description.length > 1024 || /[\r\n]/.test(description)) return null
  if (!instructions) return null
  // 技能会被反复注入后续会话，凭据混进去就是持久泄漏，宁弃勿留。
  if (containsSecretLike(`${description}\n${instructions}`)) return null
  return { name, description, instructions: instructions.slice(0, MAX_INSTRUCTIONS_CHARACTERS) }
}
