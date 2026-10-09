import { describe, expect, it } from 'vitest'
import type { GitBranchInfo, GitFileChange } from '../../shared/types'
import {
  branchRowBadge, branchSyncLabel, commitButtonText, commitDateText, filterBranchInfos, filterRemoteBranches, headLabel, retainExisting,
  statusText, statusTone, syncLabel
} from './git-view'

function branch(patch: Partial<GitBranchInfo> = {}): GitBranchInfo {
  return {
    name: 'main', current: false, upstream: null, upstreamGone: false, ahead: 0, behind: 0,
    lastCommitDate: '2026-09-10T14:22:00+08:00', lastCommitSubject: '改动', ...patch
  }
}

describe('过滤', () => {
  it('分支过滤大小写不敏感，空查询原样返回', () => {
    const list = [branch({ name: 'main' }), branch({ name: 'feat/Git-Panel' })]
    expect(filterBranchInfos(list, '')).toBe(list)
    expect(filterBranchInfos(list, 'git').map((item) => item.name)).toEqual(['feat/Git-Panel'])
    expect(filterBranchInfos(list, '  MAIN ').map((item) => item.name)).toEqual(['main'])
    expect(filterBranchInfos(list, 'zzz')).toEqual([])
  })

  it('远程分支过滤规则一致', () => {
    const remotes = ['origin/main', 'origin/feat/x']
    expect(filterRemoteBranches(remotes, 'feat')).toEqual(['origin/feat/x'])
    expect(filterRemoteBranches(remotes, '')).toBe(remotes)
  })
})

describe('syncLabel', () => {
  it('没有 upstream 时给出警告态', () => {
    expect(syncLabel(null).tone).toBe('warn')
    expect(syncLabel(null).text).toBe('无 upstream')
  })

  it('upstream 已删除优先提示', () => {
    expect(syncLabel({ upstream: 'origin/main', ahead: 1, behind: 0 }, true).text).toBe('远程已删除')
  })

  it('一致时是 ok，有差距时给出 ↑↓', () => {
    expect(syncLabel({ upstream: 'origin/main', ahead: 0, behind: 0 })).toMatchObject({ text: '已同步', tone: 'ok' })
    expect(syncLabel({ upstream: 'origin/main', ahead: 2, behind: 1 })).toMatchObject({ text: '↑2 ↓1', tone: 'info' })
    expect(syncLabel({ upstream: 'origin/main', ahead: 0, behind: 3 }).text).toBe('↓3')
  })

  it('分支行没有 upstream 时标本地', () => {
    expect(branchSyncLabel(branch()).text).toBe('本地')
    expect(branchSyncLabel(branch({ upstream: 'origin/main', ahead: 1 })).text).toBe('↑1')
  })
})

describe('状态码', () => {
  it('转中文说明', () => {
    expect(statusText('M')).toBe('已修改')
    expect(statusText('??')).toBe('未跟踪')
    expect(statusText('X')).toBe('X')
  })

  it('着色语义', () => {
    expect(statusTone('A')).toBe('add')
    expect(statusTone('?')).toBe('add')
    expect(statusTone('D')).toBe('del')
    expect(statusTone('U')).toBe('conflict')
    expect(statusTone('M')).toBe('warn')
  })
})

describe('commitDateText', () => {
  const now = new Date('2026-09-12T10:00:00+08:00')

  it('当天显示时分', () => {
    expect(commitDateText('2026-09-12T08:30:00+08:00', now)).toBe('08:30')
  })

  it('同年省略年份，跨年补上年份', () => {
    expect(commitDateText('2026-09-10T14:22:00+08:00', now)).toBe('09-10 14:22')
    expect(commitDateText('2025-12-31T23:00:00+08:00', now)).toBe('2025-12-31 23:00')
  })

  it('非法时间原样返回', () => {
    expect(commitDateText('not-a-date', now)).toBe('not-a-date')
  })
})

describe('headLabel', () => {
  it('detached 显示短哈希，普通分支显示名称', () => {
    expect(headLabel(null)).toBe('—')
    expect(headLabel({ isGitRepository: true, branch: 'main', detachedHead: false, headShort: null, changedFiles: 0, isDirty: false })).toBe('main')
    expect(headLabel({ isGitRepository: true, branch: null, detachedHead: true, headShort: 'abc1234', changedFiles: 0, isDirty: false })).toBe('detached · abc1234')
  })
})

describe('commitButtonText', () => {
  it('按暂存数量与 amend 给出文案', () => {
    expect(commitButtonText(2, 1, 0, false)).toBe('提交 2 个文件')
    expect(commitButtonText(0, 0, 0, false)).toBe('没有可提交的改动')
    expect(commitButtonText(0, 0, 0, true)).toBe('修正上次提交')
    expect(commitButtonText(2, 0, 0, true)).toBe('修正上次提交（并入 2 个文件）')
  })

  it('暂存区为空时写清楚会带上哪几段', () => {
    expect(commitButtonText(0, 5, 2, false)).toBe('暂存 5 个已修改 + 2 个未纳管并提交')
    expect(commitButtonText(0, 5, 0, false)).toBe('暂存 5 个已修改并提交')
    expect(commitButtonText(0, 0, 2, false)).toBe('暂存 2 个未纳管并提交')
  })
})

describe('retainExisting', () => {
  it('刷新后剔除已消失的路径', () => {
    const files: GitFileChange[] = [
      { path: 'a.ts', status: 'M', additions: 1, deletions: 0, binary: false, untracked: false }
    ]
    expect([...retainExisting(new Set(['a.ts', 'gone.ts']), files)]).toEqual(['a.ts'])
  })
})

describe('branchRowBadge', () => {
  const base: GitBranchInfo = { name: 'feat/a', current: false, upstream: null, upstreamGone: false, ahead: 0, behind: 0, lastCommitDate: '', lastCommitSubject: '' }
  it('没 upstream 或已同步时不挂角标', () => {
    expect(branchRowBadge(base)).toBeNull()
    expect(branchRowBadge({ ...base, upstream: 'origin/feat/a' })).toBeNull()
  })
  it('领先落后与远程已删才挂', () => {
    expect(branchRowBadge({ ...base, upstream: 'origin/feat/a', ahead: 2 })?.text).toBe('↑2')
    expect(branchRowBadge({ ...base, upstream: 'origin/feat/a', upstreamGone: true })?.text).toBe('远程已删除')
  })
})
