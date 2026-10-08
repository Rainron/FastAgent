const MAX_SHELL_CONTEXT = 32 * 1024
const MAX_SHELL_TURNS = 8
const MARKER = '[以下是之前直接执行命令的结果，仅供参考]'

interface ShellContextTurn {
  userMessage?: { text?: string | null } | null
  assistantMessage?: { text?: string | null } | null
}

export function collectShellContext(turns: readonly ShellContextTurn[]): string {
  const shellTurns = turns
    .filter((turn) => {
      const text = turn.userMessage?.text
      return typeof text === 'string' && /^!\S/.test(text) && !text.startsWith('!!') && Boolean(turn.assistantMessage?.text?.trim())
    })
    .slice(-MAX_SHELL_TURNS)
  if (!shellTurns.length) return ''
  const body = shellTurns.map((turn) => `${turn.userMessage?.text}\n${turn.assistantMessage?.text}`).join('\n\n')
  const available = MAX_SHELL_CONTEXT - MARKER.length - 2
  const bounded = body.length > available ? body.slice(body.length - available) : body
  return `${MARKER}\n${bounded}`
}
