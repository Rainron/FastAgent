import { describe, expect, it } from 'vitest'
import {
  accountModeFor,
  defaultSandboxSettings,
  normalizeSandboxSettings,
  resolveSandboxPolicy,
  sanitizeEnvironment,
  sandboxAccountName
} from './sandbox'

describe('normalizeSandboxSettings', () => {
  it('缺字段时回落到默认值', () => {
    const { settings, downgraded } = normalizeSandboxSettings(undefined)
    expect(settings).toEqual(defaultSandboxSettings)
    expect(downgraded).toBe(false)
  })

  it('restricted 显式降级为 full 并标记 downgraded', () => {
    const { settings, downgraded } = normalizeSandboxSettings({ ...defaultSandboxSettings, networkMode: 'restricted' })
    expect(settings.networkMode).toBe('full')
    expect(downgraded).toBe(true)
  })

  it('非法枚举与脏数据被裁剪', () => {
    const { settings } = normalizeSandboxSettings({ enabled: 'yes', mode: 'paranoid', networkMode: 'lan', allowedDomains: ['GitHub.com', 1, ' ', 'github.com'] })
    expect(settings.enabled).toBe(defaultSandboxSettings.enabled)
    expect(settings.mode).toBe('standard')
    expect(settings.networkMode).toBe('full')
    expect(settings.allowedDomains).toEqual(['github.com'])
  })
})

describe('resolveSandboxPolicy', () => {
  it('standard 保留网络设置并授予工作区写权限', () => {
    const policy = resolveSandboxPolicy(defaultSandboxSettings, { workspacePath: 'D:\\work', home: 'C:\\Users\\lake' })
    expect(policy.filesystem.workspaceWrite).toBe(true)
    expect(policy.filesystem.allowWrite).toEqual(['D:\\work'])
    expect(policy.network.mode).toBe('full')
    expect(policy.filesystem.denyRead.some((path) => path.endsWith('.ssh'))).toBe(true)
  })

  it('strict 强制断网并禁止降级', () => {
    const policy = resolveSandboxPolicy({ ...defaultSandboxSettings, mode: 'strict', allowUnsandboxedFallback: true }, { workspacePath: 'D:\\work', home: 'C:\\Users\\lake' })
    expect(policy.network.mode).toBe('off')
    expect(policy.process.allowUnsandboxedFallback).toBe(false)
    expect(policy.filesystem.denyRead).toEqual(['C:\\Users\\lake'])
  })

  it('没有工作区时不授予任何写权限', () => {
    const policy = resolveSandboxPolicy(defaultSandboxSettings, { workspacePath: null })
    expect(policy.filesystem.workspaceWrite).toBe(false)
    expect(policy.filesystem.allowWrite).toEqual([])
  })
})

describe('accountModeFor', () => {
  it('断网走离线账户，其余走在线账户', () => {
    const offline = resolveSandboxPolicy({ ...defaultSandboxSettings, networkMode: 'off' }, { workspacePath: null })
    const online = resolveSandboxPolicy(defaultSandboxSettings, { workspacePath: null })
    expect(accountModeFor(offline)).toBe('offline')
    expect(accountModeFor(online)).toBe('online')
    expect(sandboxAccountName('offline')).toBe('FastAgentSandboxOff')
  })
})

describe('sanitizeEnvironment', () => {
  it('只保留白名单变量', () => {
    const env = sanitizeEnvironment({ PATH: 'C:\\bin', COMPANY_INTERNAL_VAR: 'x', TEMP: 'C:\\Temp' })
    expect(env).toEqual({ PATH: 'C:\\bin', TEMP: 'C:\\Temp' })
  })

  it('工具链根目录在白名单内：少了它们 mvn/gradle 定位不到 JDK', () => {
    const env = sanitizeEnvironment({ JAVA_HOME: 'C:\\jdk', MAVEN_HOME: 'C:\\maven', PROGRAMFILES: 'C:\\Program Files' })
    expect(env).toEqual({ JAVA_HOME: 'C:\\jdk', MAVEN_HOME: 'C:\\maven', PROGRAMFILES: 'C:\\Program Files' })
  })

  it('凭据类变量一律剔除', () => {
    const env = sanitizeEnvironment({
      PATH: 'C:\\bin',
      ANTHROPIC_API_KEY: 'secret',
      GITHUB_TOKEN: 'secret',
      AWS_ACCESS_KEY_ID: 'secret',
      SSH_AUTH_SOCK: '/tmp/agent',
      PI_SESSION_ID: 'abc'
    })
    expect(Object.keys(env)).toEqual(['PATH'])
  })

  it('额外变量可以透传但仍受凭据模式约束', () => {
    const env = sanitizeEnvironment({ PATH: 'C:\\bin' }, { FASTAGENT_SANDBOX: '1', OPENAI_API_KEY: 'secret' })
    expect(env.FASTAGENT_SANDBOX).toBe('1')
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })
})
