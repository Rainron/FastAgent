import { describe, expect, it } from 'vitest'
import { defaultSandboxSettings, resolveSandboxPolicy } from '../../../../shared/sandbox'
import { buildRunnerSessionArgs, buildWorkspaceGrantArgs } from '../providers/windows-native/windows-sandbox-policy'

const policy = resolveSandboxPolicy(defaultSandboxSettings, { workspacePath: 'D:\\work', home: 'C:\\Users\\lake' })

describe('buildRunnerSessionArgs', () => {
  it('把账户、shell 与限制一起传给 runner', () => {
    const args = buildRunnerSessionArgs('s1', 'online', policy, 'powershell')
    expect(args.account).toBe('FastAgentSandboxOn')
    expect(args.shell).toBe('powershell')
    expect(args.workspacePath).toBe('D:\\work')
    expect(args.allowWrite).toEqual(['D:\\work'])
    expect(args.maxProcesses).toBeGreaterThan(0)
  })

  it('断网会话使用离线账户', () => {
    const offline = resolveSandboxPolicy({ ...defaultSandboxSettings, networkMode: 'off' }, { workspacePath: null })
    expect(buildRunnerSessionArgs('s2', 'offline', offline, 'bash').account).toBe('FastAgentSandboxOff')
  })
})

describe('buildWorkspaceGrantArgs', () => {
  it('只授权工作区本身', () => {
    expect(buildWorkspaceGrantArgs('online', 'D:\\work')).toEqual(['--grant-workspace', 'D:\\work', '--account', 'FastAgentSandboxOn'])
  })
})
