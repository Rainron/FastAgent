import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkoutBranch, createBranch, listLocalBranches, parsePorcelain, resolveGitWorkspaceState, validateBranchName } from './git'

describe('parsePorcelain', () => {
  it('空输出返回空列表', () => {
    expect(parsePorcelain('')).toEqual([])
  })

  it('解析普通变更与未跟踪文件', () => {
    expect(parsePorcelain(' M src/a.ts\n?? new.txt\n')).toEqual([
      { status: ' M', path: 'src/a.ts' },
      { status: '??', path: 'new.txt' }
    ])
  })

  it('跳过程序码不足一行的空行', () => {
    expect(parsePorcelain('\n\n M a.ts\n')).toEqual([{ status: ' M', path: 'a.ts' }])
  })

  it('重命名条目保留完整路径文本', () => {
    expect(parsePorcelain('R  old.ts -> new.ts')).toEqual([{ status: 'R ', path: 'old.ts -> new.ts' }])
  })
})

describe('validateBranchName', () => {
  it('拒绝空名', () => {
    expect(validateBranchName('')).not.toBeNull()
    expect(validateBranchName('   ')).not.toBeNull()
  })

  it('拒绝危险或非法形式', () => {
    expect(validateBranchName('--help')).not.toBeNull()
    expect(validateBranchName('-abc')).not.toBeNull()
    expect(validateBranchName('a b')).not.toBeNull()
    expect(validateBranchName('a..b')).not.toBeNull()
    expect(validateBranchName('a@{b')).not.toBeNull()
    expect(validateBranchName('a~b')).not.toBeNull()
    expect(validateBranchName('a:b')).not.toBeNull()
    expect(validateBranchName('a//b')).not.toBeNull()
    expect(validateBranchName('a.lock')).not.toBeNull()
  })

  it('接受常规分支名', () => {
    expect(validateBranchName('main')).toBeNull()
    expect(validateBranchName('feat/agent-ui')).toBeNull()
    expect(validateBranchName('feat_2024-x')).toBeNull()
  })
})

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!gitAvailable())('git 集成', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function createRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'fastagent-git-'))
    dirs.push(dir)
    execFileSync('git', ['init', '-q'], { cwd: dir })
    return dir
  }

  function defaultBranch(dir: string): string {
    return execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  }

  function commitAll(dir: string) {
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: dir })
    execFileSync('git', ['add', '-A'], { cwd: dir })
    // 空仓库可能没有任何文件，--allow-empty 保证能产生第一个 commit。
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir })
  }

  it('空仓库解析出默认分支名（无 HEAD commit）', async () => {
    const dir = createRepo()
    const state = await resolveGitWorkspaceState(dir)
    expect(state).not.toBeNull()
    expect(state?.isGitRepository).toBe(true)
    expect(state?.branch).toBe(defaultBranch(dir))
    expect(state?.detachedHead).toBe(false)
    expect(state?.isDirty).toBe(false)
  })

  it('非仓库目录返回 null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fastagent-no-git-'))
    dirs.push(dir)
    expect(await resolveGitWorkspaceState(dir)).toBeNull()
  })

  it('提交后解析当前分支与干净状态', async () => {
    const dir = createRepo()
    commitAll(dir)
    const state = await resolveGitWorkspaceState(dir)
    expect(state?.branch).toBe(defaultBranch(dir))
    expect(state?.isDirty).toBe(false)
    expect(state?.changedFiles).toBe(0)
  })

  it('未提交修改计入 dirty 与 changedFiles', async () => {
    const dir = createRepo()
    commitAll(dir)
    writeFileSync(join(dir, 'dirty.txt'), 'x')
    const state = await resolveGitWorkspaceState(dir)
    expect(state?.isDirty).toBe(true)
    expect(state?.changedFiles).toBe(1)
  })

  it('detached HEAD 显示短哈希而不是普通分支', async () => {
    const dir = createRepo()
    commitAll(dir)
    execFileSync('git', ['checkout', '-q', '--detach', 'HEAD'], { cwd: dir })
    const state = await resolveGitWorkspaceState(dir)
    expect(state?.detachedHead).toBe(true)
    expect(state?.branch).toBeNull()
    expect(state?.headShort).toBeTruthy()
  })

  it('新建分支并切换、列出本地分支、再切回', async () => {
    const dir = createRepo()
    commitAll(dir)
    const main = defaultBranch(dir)

    const created = await createBranch(dir, 'feat/dev')
    expect(created.ok).toBe(true)
    expect(created.state?.branch).toBe('feat/dev')

    const branches = await listLocalBranches(dir)
    expect(branches).toContain('feat/dev')
    expect(branches).toContain(main)

    const switched = await checkoutBranch(dir, main)
    expect(switched.ok).toBe(true)
    expect(switched.state?.branch).toBe(main)
  })

  it('新建分支名非法时返回错误且不执行', async () => {
    const dir = createRepo()
    commitAll(dir)
    const result = await createBranch(dir, 'a b')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect((await listLocalBranches(dir)).length).toBe(1)
  })
})
