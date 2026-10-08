import { describe, expect, it } from 'vitest'
import { defaultShell } from './shell'

describe('终端 shell 选择', () => {
  it('Windows 默认 PowerShell', () => {
    expect(defaultShell({ platform: 'win32', env: {} })).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
  })

  it('设置里选了 bash 且拿得到可执行文件时用 bash', () => {
    expect(defaultShell({ platform: 'win32', env: {}, prefer: 'bash', bashPath: 'C:/Git/bin/bash.exe' }))
      .toEqual({ file: 'C:/Git/bin/bash.exe', args: ['-i', '-l'] })
  })

  it('选了 bash 但没有可执行文件时回落到平台默认', () => {
    expect(defaultShell({ platform: 'win32', env: {}, prefer: 'bash', bashPath: '  ' }).file).toBe('powershell.exe')
    expect(defaultShell({ platform: 'linux', env: { SHELL: '/bin/zsh' }, prefer: 'bash', bashPath: null }))
      .toEqual({ file: '/bin/zsh', args: ['-l'] })
  })

  it('环境变量可以强制指定 shell', () => {
    expect(defaultShell({ platform: 'win32', env: { FASTAGENT_TERMINAL_SHELL: 'pwsh.exe' } })).toEqual({ file: 'pwsh.exe', args: [] })
  })

  it('类 Unix 平台没有 SHELL 时用 /bin/bash', () => {
    expect(defaultShell({ platform: 'darwin', env: {} })).toEqual({ file: '/bin/bash', args: ['-l'] })
  })
})
