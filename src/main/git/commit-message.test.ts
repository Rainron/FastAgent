import { describe, expect, it } from 'vitest'
import { buildCommitPrompt, COMMIT_DIFF_BUDGET, sanitizeCommitMessage, truncateDiff } from './commit-message'
import { terminalCandidates } from './open-external'

describe('truncateDiff', () => {
  it('未超预算时原样返回', () => {
    expect(truncateDiff('diff --git a/a b/a\n+x\n')).toBe('diff --git a/a b/a\n+x\n')
  })

  it('超预算时截断并留下提示', () => {
    const long = 'x'.repeat(COMMIT_DIFF_BUDGET + 500)
    const result = truncateDiff(long)
    expect(result.length).toBeLessThan(long.length)
    expect(result).toContain('已截断')
  })

  it('优先在文件边界截断，不留半截 hunk', () => {
    const head = `diff --git a/a.ts b/a.ts\n${'+line\n'.repeat(200)}`
    const tail = `diff --git a/b.ts b/b.ts\n${'+line\n'.repeat(200)}`
    const result = truncateDiff(head + tail, head.length + 50)
    expect(result).toContain('a.ts')
    expect(result).not.toContain('b.ts')
  })
})

describe('sanitizeCommitMessage', () => {
  it('剥掉代码块包裹', () => {
    expect(sanitizeCommitMessage('```\nfeat: 标题\n\n正文\n```')).toBe('feat: 标题\n\n正文')
    expect(sanitizeCommitMessage('```text\nfix: 修一下\n```')).toBe('fix: 修一下')
  })

  it('剥掉首尾引号并去空白', () => {
    expect(sanitizeCommitMessage('  "feat: 标题"  ')).toBe('feat: 标题')
    expect(sanitizeCommitMessage('“chore: 收尾”')).toBe('chore: 收尾')
  })

  it('超长输出被截断', () => {
    expect(sanitizeCommitMessage('a'.repeat(5000)).length).toBe(2000)
  })
})

describe('buildCommitPrompt', () => {
  it('同时带上概览与详情，并要求 Conventional Commits', () => {
    const prompt = buildCommitPrompt(' src/a.ts | 2 +-', 'diff --git a/src/a.ts b/src/a.ts')
    expect(prompt).toContain('Conventional Commits')
    expect(prompt).toContain('src/a.ts | 2 +-')
    expect(prompt).toContain('diff --git')
  })

  it('没有统计时用占位，不留空段', () => {
    expect(buildCommitPrompt('', 'diff')).toContain('（无统计）')
  })
})

describe('terminalCandidates', () => {
  it('Windows 优先 Windows Terminal，回退 cmd', () => {
    const candidates = terminalCandidates('win32')
    expect(candidates[0].command).toBe('wt.exe')
    expect(candidates[0].args('C:/repo')).toEqual(['-d', 'C:/repo'])
    expect(candidates[1].args('C:/repo')).toContain('/c')
  })

  it('macOS 与 Linux 各有候选', () => {
    expect(terminalCandidates('darwin')[0].command).toBe('open')
    expect(terminalCandidates('linux').map((item) => item.command)).toContain('gnome-terminal')
  })
})
