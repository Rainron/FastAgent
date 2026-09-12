import { describe, expect, it } from 'vitest'
import { redactSecrets, secretValuesOf } from './secret-redaction'

describe('错误消息脱敏', () => {
  it('替换掉出现在错误里的密钥值', () => {
    const message = 'auth failed for token ghp_abcdefghijklmnop at https://api.example'
    expect(redactSecrets(message, ['ghp_abcdefghijklmnop'])).toBe('auth failed for token *** at https://api.example')
  })

  it('长值优先替换，避免短值先命中留下残片', () => {
    expect(redactSecrets('key=abcd1234 and abcd', ['abcd', 'abcd1234'])).toBe('key=*** and ***')
  })

  it('过短的值不参与替换，避免把正常文本打成星号', () => {
    expect(redactSecrets('port 8080 failed', ['80'])).toBe('port 8080 failed')
  })

  it('空错误原样返回 null', () => {
    expect(redactSecrets(null, ['x'])).toBeNull()
    expect(redactSecrets(undefined, ['x'])).toBeNull()
  })

  it('从运行配置里收集 env 与 headers 的值', () => {
    expect(secretValuesOf({ env: { A: '1' }, headers: { B: '2' } })).toEqual(['1', '2'])
    expect(secretValuesOf(null)).toEqual([])
  })
})
