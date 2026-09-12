import { describe, expect, it } from 'vitest'
import { guardToolText, maskSecrets, MAX_RESULT_BYTES, truncateText } from './output-guard'

describe('output guard truncation', () => {
  it('小文本原样返回', () => {
    const result = truncateText('hello world')
    expect(result).toBe('hello world')
    expect(guardToolText('hello world').truncated).toBe(false)
  })

  it('超出上限保留头尾并标注 truncated', () => {
    const content = 'a'.repeat(MAX_RESULT_BYTES + 10_000) + 'TAIL-END'
    const result = truncateText(content)
    expect(result).toContain('…[输出已截断]…')
    expect(result).toContain('TAIL-END')
    expect(result.startsWith('a'.repeat(100))).toBe(true)
    expect(result.length).toBeLessThan(MAX_RESULT_BYTES)
    expect(guardToolText(content).truncated).toBe(true)
  })

  it('不切断多字节字符', () => {
    const content = '中文内容'.repeat(70_000)
    const result = truncateText(content)
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(MAX_RESULT_BYTES)
    // 截断点不应出现半个字符（整体输出仍应是合法 UTF-8）
    expect(Buffer.from(result, 'utf8').toString('utf8')).toBe(result)
  })
})

describe('output guard masking', () => {
  it('掩码常见的密钥键值对', () => {
    expect(maskSecrets('API_KEY=sk-abc123def')).toBe('API_KEY=******')
    expect(maskSecrets('TOKEN: abcdef')).toBe('TOKEN: ******')
    expect(maskSecrets('password = hunter2')).toBe('password = ******')
    expect(maskSecrets('PASSWORD="qwerty"')).toBe('PASSWORD=******')
  })

  it('掩码私钥块', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg\n-----END PRIVATE KEY-----'
    const masked = maskSecrets(pem)
    expect(masked).toContain('-----BEGIN PRIVATE KEY-----')
    expect(masked).not.toContain('MIIEvgIBADANBg')
    expect(masked).toContain('END PRIVATE KEY')
  })

  it('不影响普通文本', () => {
    const text = 'build succeeded in 12.4s'
    expect(maskSecrets(text)).toBe(text)
  })

  it('guardToolText 先脱敏再截断', () => {
    const content = `API_KEY=sk-secret\n${'x'.repeat(300_000)}`
    const result = guardToolText(content)
    expect(result.truncated).toBe(true)
    expect(result.text).not.toContain('sk-secret')
  })
})