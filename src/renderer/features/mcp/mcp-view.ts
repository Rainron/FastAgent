import type { McpPromptResult } from '../../../shared/types'

/** 将 MCP URI template 的简单变量替换为编码后的 URI；未填写变量保留原样，避免误读资源。 */
export function expandMcpResourceTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = values[key]
    return value === undefined || value === '' ? `{${key}}` : encodeURIComponent(value)
  })
}

/** 将 Prompt 结果转换为可放入 Composer 的纯文本，不自动发送。 */
export function promptResultText(result: McpPromptResult): string {
  return result.messages.map((message) => {
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2)
    return `[${message.role}]\n${content}`
  }).join('\n\n')
}
