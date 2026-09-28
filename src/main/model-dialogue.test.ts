import { describe, expect, it } from 'vitest'
import { extractDialogueReply } from './model-dialogue'

describe('对话测试响应解析', () => {
  it('openai chat/completions：取 choices 首条 message 的正文', () => {
    expect(extractDialogueReply('openai', { choices: [{ message: { content: 'OK' } }] })).toBe('OK')
    expect(extractDialogueReply('openai', { choices: [] })).toBeNull()
    expect(extractDialogueReply('openai', {})).toBeNull()
  })
  it('openai-responses：从 output 的多段结构里取正文', () => {
    const data = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Reply OK' }] }] }
    expect(extractDialogueReply('openai-responses', data)).toBe('Reply OK')
    expect(extractDialogueReply('openai-responses', { output: [] })).toBeNull()
  })
  it('anthropic：content 第一段 text 即可判通', () => {
    const data = { content: [{ type: 'text', text: 'OK' }, { type: 'text', text: 'again' }] }
    expect(extractDialogueReply('anthropic', data)).toBe('OK')
  })
  it('正文为空或结构异常返回 null，不误判成功', () => {
    expect(extractDialogueReply('anthropic', { content: [] })).toBeNull()
    expect(extractDialogueReply('openai', { choices: [{ message: { content: '' } }] })).toBeNull()
    expect(extractDialogueReply('openai', { choices: [{ message: {} }] })).toBeNull()
  })
})
