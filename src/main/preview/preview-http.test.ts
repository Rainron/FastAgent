import { describe, expect, it } from 'vitest'
import { mimeTypeFor, stripFrameBlockingHeaders } from './preview-http'

describe('mimeTypeFor', () => {
  it('常见网页资源', () => {
    expect(mimeTypeFor('a/index.HTML')).toBe('text/html; charset=utf-8')
    expect(mimeTypeFor('app.mjs')).toBe('text/javascript; charset=utf-8')
    expect(mimeTypeFor('logo.svg')).toBe('image/svg+xml')
    expect(mimeTypeFor('font.woff2')).toBe('font/woff2')
  })

  it('未知扩展名按二进制', () => {
    expect(mimeTypeFor('data.bin')).toBe('application/octet-stream')
    expect(mimeTypeFor('Makefile')).toBe('application/octet-stream')
  })
})

describe('stripFrameBlockingHeaders', () => {
  it('删掉 X-Frame-Options（大小写不敏感）', () => {
    expect(stripFrameBlockingHeaders({ 'X-Frame-Options': ['DENY'], 'Content-Type': ['text/html'] })).toEqual({ 'Content-Type': ['text/html'] })
    expect(stripFrameBlockingHeaders({ 'x-frame-options': ['SAMEORIGIN'] })).toEqual({})
  })

  it('CSP 只删 frame-ancestors，其余指令保留', () => {
    const result = stripFrameBlockingHeaders({ 'Content-Security-Policy': ["default-src 'self'; frame-ancestors 'none'; script-src 'self'"] })
    expect(result).toEqual({ 'Content-Security-Policy': ["default-src 'self'; script-src 'self'"] })
  })

  it('CSP 只有 frame-ancestors 时整条去掉', () => {
    expect(stripFrameBlockingHeaders({ 'content-security-policy': ["frame-ancestors 'self'"] })).toEqual({})
  })

  it('不误删名字相近的指令', () => {
    const result = stripFrameBlockingHeaders({ 'Content-Security-Policy': ['frame-src https://a.test'] })
    expect(result).toEqual({ 'Content-Security-Policy': ['frame-src https://a.test'] })
  })
})
