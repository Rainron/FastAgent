import { describe, expect, it } from 'vitest'
import { normalizeNetworkProxySettings, validateNetworkProxySettings } from './network-settings'

describe('network settings', () => {
  it('defaults old and invalid settings to auto', () => {
    for (const value of [undefined, null, {}, { mode: 'other' }, { mode: 'manual', proxyUrl: 'socks5://localhost:1080' }]) {
      expect(normalizeNetworkProxySettings(value)).toEqual({ mode: 'auto', proxyUrl: '' })
    }
  })
  it('validates manual HTTP endpoints without credentials', () => {
    expect(validateNetworkProxySettings({ mode: 'manual', proxyUrl: 'http://localhost:7890' }).proxyUrl).toBe('http://localhost:7890/')
    expect(() => validateNetworkProxySettings({ mode: 'manual', proxyUrl: 'socks5://localhost:1080' })).toThrow('HTTP')
    expect(() => validateNetworkProxySettings({ mode: 'manual', proxyUrl: 'http://user:secret@localhost:7890' })).toThrow('认证')
  })
})
