import type { ModelCredentials } from '../../shared/types'
import { promptModelOnce } from '../pi-runtime'
import { diffStat, workingDiff } from './changes'

/** 喂给模型的 diff 上限：超了先截断，宁可少给上下文也不要把请求撑爆。 */
export const COMMIT_DIFF_BUDGET = 12000

const INSTRUCTION = [
  '你在为一次 Git 提交写提交信息。',
  '要求：首行是 Conventional Commits 主题（type(scope): 描述，中文描述，不超过 50 字），',
  '如果改动涉及多处，空一行后用中文正文分条说明改了什么、为什么改。',
  '只输出提交信息本身，不要解释、不要代码块包裹。'
].join('\n')

/** 超预算时按 hunk 边界截断，避免把半行 diff 交给模型。 */
export function truncateDiff(diff: string, budget = COMMIT_DIFF_BUDGET): string {
  if (diff.length <= budget) return diff
  const cut = diff.slice(0, budget)
  const lastHunk = cut.lastIndexOf('\ndiff --git ')
  const body = lastHunk > budget / 2 ? cut.slice(0, lastHunk) : cut
  return `${body}\n…（diff 过长已截断，仅保留前一部分）`
}

export function buildCommitPrompt(stat: string, diff: string): string {
  return [INSTRUCTION, '', '改动概览：', stat.trim() || '（无统计）', '', '改动详情：', truncateDiff(diff)].join('\n')
}

/** 模型偶尔会加代码块或引号，统一剥掉再入库。 */
export function sanitizeCommitMessage(text: string): string {
  let value = text.trim()
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(value)
  if (fenced) value = fenced[1].trim()
  value = value.replace(/^["'“”]|["'“”]$/g, '').trim()
  // 提交信息本身不该超过这个量级，超了多半是模型跑题了。
  return value.slice(0, 2000)
}

/**
 * 按当前未提交改动生成提交信息。属于「问一句拿一段文本」的旁路任务，
 * 走 promptModelOnce，不落会话历史、不挂工具。
 */
export async function suggestCommitMessage(root: string, credentials: ModelCredentials): Promise<{ message: string | null; error?: string }> {
  const staged = await diffStat(root, { stagedOnly: true })
  const stagedOnly = Boolean(staged.trim())
  const stat = stagedOnly ? staged : await diffStat(root)
  const diff = await workingDiff(root, { stagedOnly })
  if (!diff.trim()) return { message: null, error: '没有可用于生成提交信息的改动' }
  try {
    const answer = await promptModelOnce({ credentials, prompt: buildCommitPrompt(stat, diff) })
    const message = sanitizeCommitMessage(answer)
    if (!message) return { message: null, error: '模型没有返回提交信息' }
    return { message }
  } catch (error) {
    return { message: null, error: error instanceof Error ? error.message : String(error) }
  }
}
