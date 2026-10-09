import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureGitExcluded } from './git-exclude'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fa-exclude-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('ensureGitExcluded', () => {
  it('不是 git 仓库时不动', () => {
    expect(ensureGitExcluded(root)).toBe(false)
  })

  it('.git 是文件（worktree 指针）时跳过', () => {
    writeFileSync(join(root, '.git'), 'gitdir: ../main/.git/worktrees/x')
    expect(ensureGitExcluded(root)).toBe(false)
  })

  it('首次写入规则，重复调用幂等', () => {
    mkdirSync(join(root, '.git'))
    expect(ensureGitExcluded(root)).toBe(true)
    expect(ensureGitExcluded(root)).toBe(false)
    const content = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8')
    expect(content.match(/\.fastagent\/previews\//g)).toHaveLength(1)
  })

  it('保留已有内容与换行风格，缺尾换行时补上', () => {
    mkdirSync(join(root, '.git', 'info'), { recursive: true })
    writeFileSync(join(root, '.git', 'info', 'exclude'), '# local\r\n*.log')
    expect(ensureGitExcluded(root)).toBe(true)
    expect(readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8')).toBe('# local\r\n*.log\r\n# FastAgent 预览样稿\r\n.fastagent/previews/\r\n')
  })

  it('已有等价规则（带前导斜杠或不带尾斜杠）不重复写', () => {
    mkdirSync(join(root, '.git', 'info'), { recursive: true })
    writeFileSync(join(root, '.git', 'info', 'exclude'), '/.fastagent/previews\n')
    expect(ensureGitExcluded(root)).toBe(false)
  })
})
