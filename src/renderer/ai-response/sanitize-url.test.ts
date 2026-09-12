import { describe, expect, it } from 'vitest'
import { isExternalHttpUrl, sanitizeLinkHref } from './sanitize-url'

describe('isExternalHttpUrl', () => {
  it('只承认 http/https', () => {
    expect(isExternalHttpUrl('http://example.com')).toBe(true)
    expect(isExternalHttpUrl('https://example.com/a?b=1')).toBe(true)
  })

  it('拒绝危险协议', () => {
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isExternalHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isExternalHttpUrl('vbscript:msgbox')).toBe(false)
  })

  it('非 URL 字符串返回 false', () => {
    expect(isExternalHttpUrl('example.com')).toBe(false)
    expect(isExternalHttpUrl('')).toBe(false)
  })
})

describe('sanitizeLinkHref', () => {
  it('放行 http/https 与站内锚点', () => {
    expect(sanitizeLinkHref('https://example.com')).toBe('https://example.com')
    expect(sanitizeLinkHref('#section')).toBe('#section')
  })

  it('不安全协议返回 null', () => {
    expect(sanitizeLinkHref('javascript:alert(1)')).toBeNull()
    expect(sanitizeLinkHref('  JavaScript:alert(1)')).toBeNull()
    expect(sanitizeLinkHref('data:text/html;base64,PHNjcmlwdD4=')).toBeNull()
  })

  it('空值返回 null', () => {
    expect(sanitizeLinkHref(undefined)).toBeNull()
    expect(sanitizeLinkHref('   ')).toBeNull()
  })
})
