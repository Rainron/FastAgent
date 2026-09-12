import { describe, expect, it } from 'vitest'
import { gitBranchLabel } from './GitBranchMenu'
import type { GitWorkspaceState } from '../../shared/types'

function state(patch: Partial<GitWorkspaceState>): GitWorkspaceState {
  return { isGitRepository: true, branch: null, detachedHead: false, headShort: null, changedFiles: 0, isDirty: false, ...patch }
}

describe('gitBranchLabel', () => {
  it('普通分支显示名称', () => {
    expect(gitBranchLabel(state({ branch: 'feat/agent-ui' }))).toBe('feat/agent-ui')
  })

  it('detached HEAD 显示短哈希', () => {
    expect(gitBranchLabel(state({ detachedHead: true, headShort: 'a31bf82' }))).toBe('detached · a31bf82')
  })

  it('detached 但无短哈希时只显示 detached', () => {
    expect(gitBranchLabel(state({ detachedHead: true, headShort: null }))).toBe('detached')
  })

  it('无分支时兜底占位', () => {
    expect(gitBranchLabel(state({}))).toBe('—')
  })
})
