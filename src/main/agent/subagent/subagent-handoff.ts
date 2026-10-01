import { SUBAGENT_LIMITS } from './subagent-types'

export interface SubAgentHandoff {
  goal: string
  verified: string[]
  unverified: string[]
  findings: string[]
  decisions: string[]
  recommendations: string[]
  remainingSteps: string[]
}

const HEADINGS: Array<[keyof SubAgentHandoff, RegExp]> = [
  ['goal', /^##\s*目标\s*$/im],
  ['verified', /^##\s*已验证项\s*$/im],
  ['unverified', /^##\s*未验证项\s*$/im],
  ['findings', /^##\s*关键发现\s*$/im],
  ['decisions', /^##\s*关键决定\s*$/im],
  ['recommendations', /^##\s*建议\s*$/im],
  ['remainingSteps', /^##\s*剩余步骤\s*$/im]
]

function lines(section: string): string[] {
  return section.split(/\r?\n/).map((line) => line.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean)
}

export function parseSubAgentHandoff(output: string): SubAgentHandoff {
  const result: SubAgentHandoff = { goal: '', verified: [], unverified: [], findings: [], decisions: [], recommendations: [], remainingSteps: [] }
  const matches = HEADINGS.flatMap(([key, pattern]) => {
    const match = pattern.exec(output)
    return match ? [{ key, index: match.index, end: match.index + match[0].length }] : []
  }).sort((a, b) => a.index - b.index)
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]
    const value = output.slice(current.end, matches[i + 1]?.index ?? output.length).trim()
    if (current.key === 'goal') result.goal = value
    else result[current.key] = lines(value)
  }
  if (!matches.length && output.trim()) result.findings = lines(output)
  return result
}

const CHAIN_SECTIONS: Array<[keyof SubAgentHandoff, string]> = [
  ['goal', '目标'],
  ['verified', '已验证项'],
  ['unverified', '未验证项'],
  ['findings', '关键发现'],
  ['decisions', '关键决定'],
  ['recommendations', '建议'],
  ['remainingSteps', '剩余步骤']
]

function clampItem(value: string): string {
  const text = value.trim()
  return text.length > SUBAGENT_LIMITS.maxChainHandoffItemCharacters
    ? `${text.slice(0, SUBAGENT_LIMITS.maxChainHandoffItemCharacters)}…`
    : text
}

/**
 * 链式任务传给下游的前序上下文。
 *
 * 原先直接拼前序**全文**（最多 50k 字符），而 handoff 早就解析出来了却没人用：
 * 链条越长膨胀越狠，第三个任务要连带背上第一个任务的全文。这里只传结构化交接，
 * 并且三个上限都卡死，让链长不再线性推高上下文。
 */
export function formatHandoffForChain(handoff: SubAgentHandoff | undefined): string {
  if (!handoff) return ''
  const blocks: string[] = []
  for (const [key, label] of CHAIN_SECTIONS) {
    const value = handoff[key]
    if (typeof value === 'string') {
      const text = clampItem(value)
      if (text) blocks.push(`## ${label}\n${text}`)
      continue
    }
    const items = value.slice(0, SUBAGENT_LIMITS.maxChainHandoffItems).map(clampItem).filter(Boolean)
    if (items.length) blocks.push(`## ${label}\n${items.map((item) => `- ${item}`).join('\n')}`)
  }
  if (!blocks.length) return ''
  const body = blocks.join('\n\n')
  const bounded = body.length > SUBAGENT_LIMITS.maxChainHandoffCharacters
    ? `${body.slice(0, SUBAGENT_LIMITS.maxChainHandoffCharacters)}\n[交接已截断]`
    : body
  return `前序 Sub-agent 交接（仅供核对，不要直接当作结论）：\n${bounded}`
}

export function truncateSubAgentOutput(output: string): { output: string; truncated: boolean } {
  if (output.length <= SUBAGENT_LIMITS.maxOutputCharacters) return { output, truncated: false }
  return { output: `${output.slice(0, SUBAGENT_LIMITS.maxOutputCharacters)}\n\n[输出已截断]`, truncated: true }
}
