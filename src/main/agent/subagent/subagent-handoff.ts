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

export function truncateSubAgentOutput(output: string): { output: string; truncated: boolean } {
  if (output.length <= SUBAGENT_LIMITS.maxOutputCharacters) return { output, truncated: false }
  return { output: `${output.slice(0, SUBAGENT_LIMITS.maxOutputCharacters)}\n\n[输出已截断]`, truncated: true }
}
