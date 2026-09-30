/**
 * 当前环境可供 Skill 声明的工具名。
 *
 * 内置工具名与 pi 运行时保持一致；MCP 工具按 `mcp__<server>__<tool>` 的实际调用名给出，
 * 同时把 server 名本身也算作可用——不少 Skill 只写「需要哪个 server」。
 */

/** pi 内置工具；shell 是两种壳的统称，声明 shell 也算命中。 */
const BUILTIN_TOOLS = ['read', 'write', 'edit', 'patch', 'grep', 'find', 'ls', 'todowrite', 'question']

export interface ToolInventoryInput {
  /** 本轮实际可用的壳工具名，如 bash / powershell。 */
  shellToolName: string | null
  /** 已启用的 MCP Server：id 与它暴露的工具名。 */
  mcpServers: ReadonlyArray<{ id: string; tools: readonly string[] }>
  /** 已启用的 CLI 工具 id。 */
  cliTools: readonly string[]
  /** Sub-agent 委派是否开启。 */
  subAgentEnabled: boolean
}

export function availableToolNames(input: ToolInventoryInput): string[] {
  const names = new Set<string>(BUILTIN_TOOLS)
  if (input.shellToolName) {
    names.add(input.shellToolName)
    names.add('shell')
  }
  if (input.subAgentEnabled) names.add('agent')
  for (const server of input.mcpServers) {
    names.add(server.id)
    names.add(`mcp__${server.id}`)
    for (const tool of server.tools) names.add(`mcp__${server.id}__${tool}`)
  }
  for (const cli of input.cliTools) {
    names.add(cli)
    names.add(`cli__${cli}`)
  }
  return [...names]
}
