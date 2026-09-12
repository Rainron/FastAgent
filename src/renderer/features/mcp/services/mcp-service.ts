import type { LocalMcpServerInput, McpServerDetail, McpTestStatus } from '../../../../shared/types'

export const mcpService = {
  detail: (id: string): Promise<McpServerDetail> => window.fastAgent.mcp.detail(id),
  save: (input: LocalMcpServerInput) => window.fastAgent.mcp.save(input),
  remove: (id: string) => window.fastAgent.mcp.remove(id),
  test: (id: string): Promise<McpTestStatus> => window.fastAgent.mcp.test(id),
  /** 保存前测试草稿配置，不落库。 */
  testConfig: (input: LocalMcpServerInput): Promise<McpTestStatus> => window.fastAgent.mcp.testConfig(input),
  import: () => window.fastAgent.mcp.import()
}
