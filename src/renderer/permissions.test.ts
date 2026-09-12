import { describe, expect, it } from 'vitest'
import { defaultPermissionForMode, permissionPresets, permissionProfile, permissionSummary } from './permissions'

describe('permission presets', () => {
  it('uses mode-specific safe defaults', () => {
    expect(defaultPermissionForMode('chat')).toBeNull()
    expect(defaultPermissionForMode('agent')).toBe('ask')
  })

  it('maps visible presets to explicit access and approval policies', () => {
    expect(permissionProfile('ask')).toMatchObject({ accessScope: 'workspace', approvalPolicy: 'ask-when-needed', filesystem: { outsideWorkspace: false }, shell: { runCommands: false } })
    expect(permissionProfile('workspace')).toMatchObject({ accessScope: 'workspace', approvalPolicy: 'high-risk', filesystem: { workspace: true, outsideWorkspace: false }, shell: { runCommands: true } })
    expect(permissionProfile('full')).toMatchObject({ accessScope: 'full', approvalPolicy: 'high-risk', filesystem: { outsideWorkspace: true }, network: { internet: true } })
  })

  it('keeps visible labels and descriptions explicit', () => {
    expect(permissionSummary('ask')).toEqual({ label: '受控模式', shortLabel: '受控', hint: '敏感操作前请求确认', description: '修改文件、执行命令或进行敏感操作前请求用户确认。', risk: false })
    expect(permissionSummary('workspace')).toEqual({ label: '工作区模式', shortLabel: '工作区', hint: '可修改当前项目并执行命令', description: '允许 Agent 在当前项目工作区内读取、修改文件以及执行命令。', risk: false })
    expect(permissionSummary('full')).toEqual({ label: '完全访问', shortLabel: '完全', hint: '访问本机资源并执行命令，不再询问', description: '允许 Agent 读写工作区外的本机文件、执行系统命令、安装依赖、联网及使用已启用能力，其间不再逐次询问；安全守卫仍会阻止高风险破坏操作与私钥文件读取。', risk: true })
  })

  it('只把完全访问标成高风险', () => {
    expect(permissionPresets.filter((preset) => permissionSummary(preset).risk)).toEqual(['full'])
  })
})
