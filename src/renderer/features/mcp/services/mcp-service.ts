import type { LocalMcpServerInput, McpPromptDescriptor, McpPromptResult, McpResourceContent, McpResourceDescriptor, McpResourceTemplateDescriptor, McpServerDetail, McpTestStatus } from '../../../../shared/types'

export const mcpService = {
  detail: (id: string): Promise<McpServerDetail> => window.fastAgent.mcp.detail(id),
  save: (input: LocalMcpServerInput) => window.fastAgent.mcp.save(input),
  remove: (id: string) => window.fastAgent.mcp.remove(id),
  test: (id: string): Promise<McpTestStatus> => window.fastAgent.mcp.test(id),
  /** 保存前测试草稿配置，不落库。 */
  testConfig: (input: LocalMcpServerInput): Promise<McpTestStatus> => window.fastAgent.mcp.testConfig(input),
  import: () => window.fastAgent.mcp.import(),
  resources: (id: string): Promise<{ resources: McpResourceDescriptor[]; templates: McpResourceTemplateDescriptor[] }> => window.fastAgent.mcp.resources(id),
  readResource: (id: string, uri: string): Promise<{ contents: McpResourceContent[] }> => window.fastAgent.mcp.readResource(id, uri),
  prompts: (id: string): Promise<{ prompts: McpPromptDescriptor[] }> => window.fastAgent.mcp.prompts(id),
  getPrompt: (id: string, name: string, args?: Record<string, string>): Promise<McpPromptResult> => window.fastAgent.mcp.getPrompt(id, name, args)
}
