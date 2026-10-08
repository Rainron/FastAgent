import { describe, expect, it } from 'vitest'
import { expandMcpResourceTemplate, promptResultText } from './mcp-view'

describe('MCP view helpers', () => {
  it('展开 URI template 时对变量编码，未填写变量保持原样', () => {
    expect(expandMcpResourceTemplate('file://docs/{name}?lang={lang}', { name: 'a b.md', lang: 'zh-CN' }))
      .toBe('file://docs/a%20b.md?lang=zh-CN')
    expect(expandMcpResourceTemplate('file://docs/{missing}', {})).toBe('file://docs/{missing}')
  })

  it('将 Prompt 消息映射为可插入 Composer 的文本', () => {
    expect(promptResultText({ messages: [
      { role: 'user', content: '总结文档' },
      { role: 'assistant', content: { type: 'text', text: '请先读取资源' } }
    ] })).toBe('[user]\n总结文档\n\n[assistant]\n{\n  "type": "text",\n  "text": "请先读取资源"\n}')
  })
})
