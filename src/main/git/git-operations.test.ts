import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTrackingBranch, deleteBranch, listBranchInfos, listRemoteBranches, parseBranchInfos, parseTrack, renameBranch, setUpstream
} from './branches'
import {
  commitChanges, discardFiles, fileDiff, listChanges, mergeNumstat, resetHead, sanitizePaths, splitStatus, stageFiles,
  unstageFiles, workingDiff
} from './changes'
import { commitDetail, commitPatch, countCommits, listCommits, parseCommitRecords, parseNumstat } from './commits'
import { abortIntegration, integrationStatus, listConflicts, mergeBranch, rebaseOnto } from './integrate'
import { addRemote, fetchRemote, listRemoteDetails, listRemotes, pullCurrent, pushCurrent, removeRemote, setRemoteUrl } from './remote'
import { listStashes, parseStashList, stashApply, stashDrop, stashPatch, stashPop, stashPush, validateStashRef } from './stash'
import { parseAheadBehind, resolveGitWorkspaceState, resolveSyncState } from './state'

const FIELD = '\x1f'
const RECORD = '\x1e'

describe('纯解析函数', () => {
  it('parseTrack 解析 ahead/behind/gone', () => {
    expect(parseTrack('[ahead 2, behind 1]')).toEqual({ ahead: 2, behind: 1, gone: false })
    expect(parseTrack('[ahead 3]')).toEqual({ ahead: 3, behind: 0, gone: false })
    expect(parseTrack('[gone]')).toEqual({ ahead: 0, behind: 0, gone: true })
    expect(parseTrack('')).toEqual({ ahead: 0, behind: 0, gone: false })
  })

  it('parseAheadBehind 按 behind<TAB>ahead 解析，异常输入归零', () => {
    expect(parseAheadBehind('1\t2\n')).toEqual({ ahead: 2, behind: 1 })
    expect(parseAheadBehind('')).toEqual({ ahead: 0, behind: 0 })
  })

  it('parseBranchInfos 解析分隔符格式并跳过空记录', () => {
    const stdout = ['main', 'origin/main', '[ahead 1]', '2026-09-10 14:22:00 +0800', '改了点东西', '*'].join(FIELD) + RECORD
      + '\n' + ['feat/x', '', '', '2026-09-09 10:00:00 +0800', '另一条', ''].join(FIELD) + RECORD + '\n'
    expect(parseBranchInfos(stdout)).toEqual([
      { name: 'main', current: true, upstream: 'origin/main', upstreamGone: false, ahead: 1, behind: 0, lastCommitDate: '2026-09-10 14:22:00 +0800', lastCommitSubject: '改了点东西' },
      { name: 'feat/x', current: false, upstream: null, upstreamGone: false, ahead: 0, behind: 0, lastCommitDate: '2026-09-09 10:00:00 +0800', lastCommitSubject: '另一条' }
    ])
  })

  it('parseCommitRecords 解析多父提交与引用', () => {
    const stdout = ['abc123def', 'abc123d', 'p1 p2', 'lake', 'l@x.com', '2026-09-10T14:22:00+08:00', 'feat: 标题', 'HEAD -> main, tag: v1'].join(FIELD) + RECORD
    expect(parseCommitRecords(stdout)).toEqual([{
      hash: 'abc123def', shortHash: 'abc123d', parents: ['p1', 'p2'], author: 'lake', email: 'l@x.com',
      date: '2026-09-10T14:22:00+08:00', subject: 'feat: 标题', refs: ['HEAD -> main', 'tag: v1']
    }])
  })

  it('parseNumstat 处理二进制与含制表符路径', () => {
    expect(parseNumstat('12\t3\tsrc/a.ts\n-\t-\tbuild/icon.png\n')).toEqual([
      { path: 'src/a.ts', additions: 12, deletions: 3, binary: false },
      { path: 'build/icon.png', additions: 0, deletions: 0, binary: true }
    ])
  })

  it('splitStatus 按 XY 拆分暂存与未暂存，重命名取新路径', () => {
    const split = splitStatus([
      { status: 'M ', path: 'staged.ts' },
      { status: ' M', path: 'dirty.ts' },
      { status: 'MM', path: 'both.ts' },
      { status: '??', path: 'new.ts' },
      { status: 'R ', path: 'old.ts -> new-name.ts' }
    ])
    expect(split.staged.map((item) => item.path)).toEqual(['staged.ts', 'both.ts', 'new-name.ts'])
    expect(split.unstaged.map((item) => item.path)).toEqual(['dirty.ts', 'both.ts', 'new.ts'])
    expect(split.unstaged.find((item) => item.path === 'new.ts')?.untracked).toBe(true)
  })

  it('mergeNumstat 只补上有统计的文件', () => {
    const merged = mergeNumstat(
      [{ path: 'a.ts', status: 'M', additions: 0, deletions: 0, binary: false, untracked: false },
        { path: 'b.ts', status: '?', additions: 0, deletions: 0, binary: false, untracked: true }],
      [{ path: 'a.ts', additions: 5, deletions: 2, binary: false }]
    )
    expect(merged[0].additions).toBe(5)
    expect(merged[1].additions).toBe(0)
  })

  it('sanitizePaths 拒绝越界、绝对路径与选项形状', () => {
    expect(sanitizePaths(['src/a.ts']).paths).toEqual(['src/a.ts'])
    expect(sanitizePaths(['../outside.ts']).error).toBeTruthy()
    expect(sanitizePaths(['--force']).error).toBeTruthy()
    expect(sanitizePaths([process.platform === 'win32' ? 'C:/tmp/a.ts' : '/tmp/a.ts']).error).toBeTruthy()
    expect(sanitizePaths([]).error).toBeTruthy()
  })

  it('parseStashList 与 validateStashRef', () => {
    expect(parseStashList(['stash@{0}', 'WIP on main: 改动', '2026-09-10T14:22:00+08:00'].join(FIELD) + RECORD))
      .toEqual([{ ref: 'stash@{0}', message: 'WIP on main: 改动', date: '2026-09-10T14:22:00+08:00' }])
    expect(validateStashRef('stash@{2}')).toBeNull()
    expect(validateStashRef('stash@{a}')).toBeTruthy()
    expect(validateStashRef('HEAD')).toBeTruthy()
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

describe.skipIf(!gitAvailable())('git 能力层集成', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function run(dir: string, args: string[]): string {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  }

  function createRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'fastagent-gitops-'))
    dirs.push(dir)
    run(dir, ['init', '-q'])
    run(dir, ['config', 'user.name', 'test'])
    run(dir, ['config', 'user.email', 'test@test'])
    // 变基/合并测试要稳定的提交时间，固定身份即可，其余用默认。
    return dir
  }

  function write(dir: string, name: string, content: string) {
    writeFileSync(join(dir, name), content, 'utf8')
  }

  function commit(dir: string, message: string) {
    run(dir, ['add', '-A'])
    run(dir, ['commit', '-q', '--allow-empty', '-m', message])
  }

  function seeded(): string {
    const dir = createRepo()
    write(dir, 'a.txt', 'one\n')
    commit(dir, 'init')
    return dir
  }

  function head(dir: string): string {
    return run(dir, ['rev-parse', 'HEAD'])
  }

  function currentBranch(dir: string): string {
    return run(dir, ['branch', '--show-current'])
  }

  describe('工作区改动', () => {
    it('listChanges 区分已暂存、未暂存与未跟踪，并带增删行数', async () => {
      const dir = seeded()
      write(dir, 'a.txt', 'one\ntwo\n')
      write(dir, 'b.txt', 'new file\n')
      run(dir, ['add', 'a.txt'])
      write(dir, 'c.txt', 'untracked\n')

      const changes = await listChanges(dir)
      expect(changes.staged.map((item) => item.path)).toEqual(['a.txt'])
      expect(changes.staged[0].additions).toBe(1)
      expect(changes.unstaged.map((item) => item.path).sort()).toEqual(['b.txt', 'c.txt'])
      expect(changes.unstaged.every((item) => item.untracked)).toBe(true)
    })

    it('stageFiles / unstageFiles 往返', async () => {
      const dir = seeded()
      write(dir, 'a.txt', 'changed\n')

      expect((await stageFiles(dir, ['a.txt'])).ok).toBe(true)
      expect((await listChanges(dir)).staged.map((item) => item.path)).toEqual(['a.txt'])

      expect((await unstageFiles(dir, ['a.txt'])).ok).toBe(true)
      const after = await listChanges(dir)
      expect(after.staged).toEqual([])
      expect(after.unstaged.map((item) => item.path)).toEqual(['a.txt'])
    })

    it('unstageFiles 在没有任何提交的仓库里也能生效', async () => {
      const dir = createRepo()
      write(dir, 'first.txt', 'x\n')
      run(dir, ['add', 'first.txt'])

      expect((await unstageFiles(dir, ['first.txt'])).ok).toBe(true)
      const changes = await listChanges(dir)
      expect(changes.staged).toEqual([])
      expect(changes.unstaged[0].untracked).toBe(true)
    })

    it('stageFiles 拒绝越界路径且不执行 git', async () => {
      const dir = seeded()
      const result = await stageFiles(dir, ['../evil.txt'])
      expect(result.ok).toBe(false)
      expect(result.error).toContain('越出仓库')
    })

    it('commitChanges 提交暂存内容，空信息被拒', async () => {
      const dir = seeded()
      write(dir, 'a.txt', 'two\n')
      await stageFiles(dir, ['a.txt'])

      expect((await commitChanges(dir, '   ')).ok).toBe(false)
      const result = await commitChanges(dir, 'feat: 第二条')
      expect(result.ok).toBe(true)
      expect(result.state?.isDirty).toBe(false)
      expect(run(dir, ['log', '-1', '--format=%s'])).toBe('feat: 第二条')
    })

    it('commitChanges amend 并入上一条提交且不增加提交数', async () => {
      const dir = seeded()
      const before = await countCommits(dir, 'HEAD')
      write(dir, 'a.txt', 'amended\n')
      await stageFiles(dir, ['a.txt'])

      const result = await commitChanges(dir, 'init（已修正）', { amend: true })
      expect(result.ok).toBe(true)
      expect(await countCommits(dir, 'HEAD')).toBe(before)
      expect(run(dir, ['log', '-1', '--format=%s'])).toBe('init（已修正）')
    })

    it('discardFiles 回滚已跟踪文件并删除未跟踪文件', async () => {
      const dir = seeded()
      write(dir, 'a.txt', 'dirty\n')
      write(dir, 'temp.txt', 'junk\n')

      const result = await discardFiles(dir, ['a.txt'], { untracked: ['temp.txt'] })
      expect(result.ok).toBe(true)
      expect(run(dir, ['status', '--porcelain'])).toBe('')
      expect(existsSync(join(dir, 'temp.txt'))).toBe(false)
    })

    it('resetHead mixed 保留改动但回退提交', async () => {
      const dir = seeded()
      write(dir, 'a.txt', 'two\n')
      commit(dir, 'second')
      expect(await countCommits(dir, 'HEAD')).toBe(2)

      const result = await resetHead(dir, 'mixed')
      expect(result.ok).toBe(true)
      expect(await countCommits(dir, 'HEAD')).toBe(1)
      expect((await listChanges(dir)).unstaged.map((item) => item.path)).toEqual(['a.txt'])
    })

    it('resetHead soft 把改动留在暂存区', async () => {
      const dir = seeded()
      write(dir, 'a.txt', 'two\n')
      commit(dir, 'second')

      expect((await resetHead(dir, 'soft')).ok).toBe(true)
      expect((await listChanges(dir)).staged.map((item) => item.path)).toEqual(['a.txt'])
    })

    it('fileDiff 覆盖未暂存 / 已暂存 / 未跟踪三种来源', async () => {
      const dir = seeded()
      write(dir, 'a.txt', 'one\nextra\n')
      expect(await fileDiff(dir, 'a.txt', false)).toContain('+extra')

      await stageFiles(dir, ['a.txt'])
      expect(await fileDiff(dir, 'a.txt', true)).toContain('+extra')
      expect(await fileDiff(dir, 'a.txt', false)).toBe('')

      write(dir, 'fresh.txt', 'brand new\n')
      expect(await fileDiff(dir, 'fresh.txt', false, true)).toContain('+brand new')
    })

    it('workingDiff 汇总已暂存与未暂存的改动', async () => {
      const dir = seeded()
      write(dir, 'a.txt', 'one\nstaged\n')
      await stageFiles(dir, ['a.txt'])
      write(dir, 'a.txt', 'one\nstaged\nworktree\n')

      const diff = await workingDiff(dir)
      expect(diff).toContain('+staged')
      expect(diff).toContain('+worktree')
    })

    it('workingDiff 带上未跟踪文件，stagedOnly 时不带', async () => {
      const dir = seeded()
      write(dir, 'fresh.txt', '全新内容\n')

      const full = await workingDiff(dir)
      expect(full).toContain('fresh.txt')
      expect(full).toContain('+全新内容')

      expect(await workingDiff(dir, { stagedOnly: true })).not.toContain('fresh.txt')
    })
  })

  describe('中文路径编码', () => {
    // 回归测试：listChanges 拿到的路径必须是真实中文，而不是 git 的 octal escape（"\344\270\255..."）
    // 或被 ANSI 代码页误解码后的乱码。
    it('listChanges 正确返回含中文文件名的路径', async () => {
      const dir = seeded()
      write(dir, '中文.txt', '一\n二\n')
      run(dir, ['add', '中文.txt'])

      const changes = await listChanges(dir)
      const allPaths = [...changes.staged.map((item) => item.path), ...changes.unstaged.map((item) => item.path)]
      expect(allPaths).toContain('中文.txt')
      // 关键断言：路径里不应出现 git 的 octal 转义或乱码字符。
      for (const path of allPaths) {
        expect(path).not.toMatch(/\\[0-7]{3}/)
      }
    })

    it('fileDiff 在中文路径上不会把路径转成 octal', async () => {
      const dir = seeded()
      write(dir, '中文笔记.md', '# 标题\n内容\n')
      await stageFiles(dir, ['中文笔记.md'])
      const diff = await fileDiff(dir, '中文笔记.md', true)
      expect(diff).toContain('中文笔记.md')
      expect(diff).not.toMatch(/\\[0-7]{3}/)
    })
  })

  describe('提交浏览', () => {
    it('listCommits 分页与 countCommits', async () => {
      const dir = seeded()
      commit(dir, 'second')
      commit(dir, 'third')

      const all = await listCommits(dir, 'HEAD', 10)
      expect(all.map((item) => item.subject)).toEqual(['third', 'second', 'init'])
      expect(await countCommits(dir, 'HEAD')).toBe(3)

      const page = await listCommits(dir, 'HEAD', 1, 1)
      expect(page.map((item) => item.subject)).toEqual(['second'])
    })

    it('listCommits 按分支取各自历史', async () => {
      const dir = seeded()
      const base = currentBranch(dir)
      run(dir, ['checkout', '-q', '-b', 'feat/x'])
      commit(dir, 'only on feat')

      expect((await listCommits(dir, 'feat/x', 10)).map((item) => item.subject)).toEqual(['only on feat', 'init'])
      expect((await listCommits(dir, base, 10)).map((item) => item.subject)).toEqual(['init'])
    })

    it('commitDetail 带回完整元信息与改动文件', async () => {
      const dir = seeded()
      write(dir, 'a.txt', 'one\ntwo\n')
      write(dir, 'new.txt', 'x\n')
      run(dir, ['add', '-A'])
      run(dir, ['commit', '-q', '-m', 'feat: 标题\n\n正文说明'])

      const detail = await commitDetail(dir, head(dir))
      expect(detail?.subject).toBe('feat: 标题')
      expect(detail?.body).toContain('正文说明')
      expect(detail?.author).toBe('test')
      expect(detail?.parents.length).toBe(1)
      expect(detail?.files.map((file) => file.path).sort()).toEqual(['a.txt', 'new.txt'])
      expect(detail?.files.find((file) => file.path === 'a.txt')?.additions).toBe(1)
    })

    it('commitDetail 对无效哈希返回 null，不执行危险参数', async () => {
      const dir = seeded()
      expect(await commitDetail(dir, '--exec=rm')).toBeNull()
      expect(await commitDetail(dir, 'deadbeef')).toBeNull()
    })

    it('commitPatch 可按文件裁剪', async () => {
      const dir = seeded()
      write(dir, 'a.txt', 'one\nchanged\n')
      write(dir, 'b.txt', 'other\n')
      commit(dir, 'two files')

      const full = await commitPatch(dir, head(dir))
      expect(full).toContain('a.txt')
      expect(full).toContain('b.txt')

      const single = await commitPatch(dir, head(dir), 'b.txt')
      expect(single).toContain('b.txt')
      expect(single).not.toContain('+changed')
    })
  })

  describe('分支管理', () => {
    it('listBranchInfos 标记当前分支并带最近提交主题', async () => {
      const dir = seeded()
      run(dir, ['checkout', '-q', '-b', 'feat/x'])
      commit(dir, 'feat 提交')

      const infos = await listBranchInfos(dir)
      const feat = infos.find((item) => item.name === 'feat/x')
      expect(feat?.current).toBe(true)
      expect(feat?.lastCommitSubject).toBe('feat 提交')
      expect(feat?.upstream).toBeNull()
    })

    it('deleteBranch 对未合并分支要求强制，force 后删除', async () => {
      const dir = seeded()
      const base = currentBranch(dir)
      run(dir, ['checkout', '-q', '-b', 'feat/drop'])
      commit(dir, '未合并的改动')
      run(dir, ['checkout', '-q', base])

      const refused = await deleteBranch(dir, 'feat/drop')
      expect(refused.ok).toBe(false)
      expect(refused.needsForce).toBe(true)

      const forced = await deleteBranch(dir, 'feat/drop', true)
      expect(forced.ok).toBe(true)
      expect((await listBranchInfos(dir)).map((item) => item.name)).not.toContain('feat/drop')
    })

    it('deleteBranch 删除已合并分支无需强制', async () => {
      const dir = seeded()
      const base = currentBranch(dir)
      run(dir, ['branch', 'feat/merged'])
      run(dir, ['checkout', '-q', base])
      expect((await deleteBranch(dir, 'feat/merged')).ok).toBe(true)
    })

    it('renameBranch 改名成功，重名时失败', async () => {
      const dir = seeded()
      run(dir, ['branch', 'feat/old'])
      run(dir, ['branch', 'feat/taken'])

      expect((await renameBranch(dir, 'feat/old', 'feat/new')).ok).toBe(true)
      const names = (await listBranchInfos(dir)).map((item) => item.name)
      expect(names).toContain('feat/new')
      expect(names).not.toContain('feat/old')

      const clash = await renameBranch(dir, 'feat/new', 'feat/taken')
      expect(clash.ok).toBe(false)
      expect(clash.error).toBeTruthy()
    })

    it('分支操作拒绝非法名称', async () => {
      const dir = seeded()
      expect((await deleteBranch(dir, '--force')).ok).toBe(false)
      expect((await renameBranch(dir, 'main', 'a b')).ok).toBe(false)
      expect((await createTrackingBranch(dir, '--upload-pack=evil')).ok).toBe(false)
    })
  })

  describe('远程同步', () => {
    function withRemote(): { dir: string; remote: string; branch: string } {
      const dir = seeded()
      const remote = mkdtempSync(join(tmpdir(), 'fastagent-gitremote-'))
      dirs.push(remote)
      execFileSync('git', ['init', '-q', '--bare'], { cwd: remote })
      run(dir, ['remote', 'add', 'origin', remote])
      return { dir, remote, branch: currentBranch(dir) }
    }

    it('首次 push 自动建立 upstream，之后 ahead/behind 可解析', async () => {
      const { dir, branch } = withRemote()
      expect(await resolveSyncState(dir)).toBeNull()

      const pushed = await pushCurrent(dir)
      expect(pushed.ok).toBe(true)
      expect((await resolveSyncState(dir))?.upstream).toBe(`origin/${branch}`)

      commit(dir, '本地新提交')
      const sync = await resolveSyncState(dir)
      expect(sync).toEqual({ upstream: `origin/${branch}`, ahead: 1, behind: 0 })
      expect((await resolveGitWorkspaceState(dir))?.sync?.ahead).toBe(1)
    })

    it('添加 / 改地址 / 删除远程', async () => {
      const dir = seeded()
      const target = mkdtempSync(join(tmpdir(), 'fastagent-gitremote3-'))
      dirs.push(target)
      execFileSync('git', ['init', '-q', '--bare'], { cwd: target })

      expect((await addRemote(dir, 'origin', target)).ok).toBe(true)
      expect(await listRemoteDetails(dir)).toEqual([{ name: 'origin', url: target }])

      const moved = mkdtempSync(join(tmpdir(), 'fastagent-gitremote4-'))
      dirs.push(moved)
      expect((await setRemoteUrl(dir, 'origin', moved)).ok).toBe(true)
      expect((await listRemoteDetails(dir))[0].url).toBe(moved)

      expect((await removeRemote(dir, 'origin')).ok).toBe(true)
      expect(await listRemoteDetails(dir)).toEqual([])
    })

    it('添加远程时校验名字与地址', async () => {
      const dir = seeded()
      expect((await addRemote(dir, '', 'https://example.com/x.git')).error).toBe('远程名不能为空')
      expect((await addRemote(dir, 'origin', '')).error).toBe('仓库地址不能为空')
      expect((await addRemote(dir, 'origin', '--upload-pack=evil')).error).toBe('仓库地址不合法')
    })

    it('显式指定远程时推到该远程，已有 upstream 也生效', async () => {
      const { dir, branch } = withRemote()
      const second = mkdtempSync(join(tmpdir(), 'fastagent-gitremote2-'))
      dirs.push(second)
      execFileSync('git', ['init', '-q', '--bare'], { cwd: second })
      run(dir, ['remote', 'add', 'backup', second])

      expect((await pushCurrent(dir)).ok).toBe(true)
      expect((await resolveSyncState(dir))?.upstream).toBe(`origin/${branch}`)

      commit(dir, '给 backup 的提交')
      expect((await pushCurrent(dir, { remote: 'backup' })).ok).toBe(true)
      // backup 收到了这条提交，而 upstream 仍然指向 origin（已有跟踪时不该被改写）
      expect(execFileSync('git', ['log', '-1', '--pretty=%s', branch], { cwd: second, encoding: 'utf8' }).trim())
        .toBe('给 backup 的提交')
      expect((await resolveSyncState(dir))?.upstream).toBe(`origin/${branch}`)
    })

    it('拒绝不合法的远程名', async () => {
      const { dir } = withRemote()
      const result = await pushCurrent(dir, { remote: '--upload-pack=evil' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('远程名不合法')
    })

    it('pull --ff-only 拉回远程新提交', async () => {
      const { dir, remote, branch } = withRemote()
      expect((await pushCurrent(dir)).ok).toBe(true)

      // 另一个克隆推一条上去，模拟远程有了新提交。
      const other = mkdtempSync(join(tmpdir(), 'fastagent-gitclone-'))
      dirs.push(other)
      execFileSync('git', ['clone', '-q', remote, other], { cwd: tmpdir() })
      execFileSync('git', ['config', 'user.name', 'other'], { cwd: other })
      execFileSync('git', ['config', 'user.email', 'other@test'], { cwd: other })
      writeFileSync(join(other, 'remote.txt'), 'from remote\n', 'utf8')
      execFileSync('git', ['add', '-A'], { cwd: other })
      execFileSync('git', ['commit', '-q', '-m', '远程提交'], { cwd: other })
      execFileSync('git', ['push', '-q', 'origin', branch], { cwd: other })

      expect((await fetchRemote(dir)).ok).toBe(true)
      expect((await resolveSyncState(dir))?.behind).toBe(1)

      expect((await pullCurrent(dir)).ok).toBe(true)
      expect(existsSync(join(dir, 'remote.txt'))).toBe(true)
      expect((await resolveSyncState(dir))?.behind).toBe(0)
    })

    it('没有 upstream 时 pull 明确报错', async () => {
      const dir = seeded()
      const result = await pullCurrent(dir)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('upstream')
    })

    it('listRemotes 与 setUpstream 手动绑定跟踪分支', async () => {
      const { dir, branch } = withRemote()
      expect(await listRemotes(dir)).toEqual(['origin'])
      expect((await pushCurrent(dir)).ok).toBe(true)

      run(dir, ['branch', '--unset-upstream'])
      expect(await resolveSyncState(dir)).toBeNull()

      expect((await setUpstream(dir, branch, `origin/${branch}`)).ok).toBe(true)
      expect((await resolveSyncState(dir))?.upstream).toBe(`origin/${branch}`)

      expect((await setUpstream(dir, branch, null)).ok).toBe(true)
      expect(await resolveSyncState(dir)).toBeNull()
    })

    it('listRemoteBranches 列出远程分支且排除 HEAD 别名，可检出为本地跟踪分支', async () => {
      const { dir, remote, branch } = withRemote()
      expect((await pushCurrent(dir)).ok).toBe(true)
      run(dir, ['checkout', '-q', '-b', 'feat/remote-only'])
      commit(dir, '远程独有分支')
      run(dir, ['push', '-q', '-u', 'origin', 'feat/remote-only'])
      run(dir, ['checkout', '-q', branch])
      run(dir, ['branch', '-q', '-D', 'feat/remote-only'])

      const remotes = await listRemoteBranches(dir)
      expect(remotes).toContain('origin/feat/remote-only')
      expect(remotes.some((name) => name.endsWith('/HEAD'))).toBe(false)
      expect(remote).toBeTruthy()

      const created = await createTrackingBranch(dir, 'origin/feat/remote-only')
      expect(created.ok).toBe(true)
      expect(currentBranch(dir)).toBe('feat/remote-only')
      expect((await resolveSyncState(dir))?.upstream).toBe('origin/feat/remote-only')
    })
  })

  describe('stash', () => {
    it('push / list / apply / pop / drop 全链路', async () => {
      const dir = seeded()
      write(dir, 'a.txt', 'stashed\n')

      expect((await stashPush(dir, '改了一半')).ok).toBe(true)
      expect(run(dir, ['status', '--porcelain'])).toBe('')

      const list = await listStashes(dir)
      expect(list.length).toBe(1)
      expect(list[0].ref).toBe('stash@{0}')
      expect(list[0].message).toContain('改了一半')
      expect(await stashPatch(dir, 'stash@{0}')).toContain('+stashed')

      expect((await stashApply(dir, 'stash@{0}')).ok).toBe(true)
      expect(run(dir, ['status', '--porcelain'])).not.toBe('')
      expect((await listStashes(dir)).length).toBe(1)

      expect((await stashDrop(dir, 'stash@{0}')).ok).toBe(true)
      expect(await listStashes(dir)).toEqual([])
    })

    it('stashPush --include-untracked 收走未跟踪文件，pop 后恢复', async () => {
      const dir = seeded()
      write(dir, 'fresh.txt', 'new\n')

      expect((await stashPush(dir, '含未跟踪', { includeUntracked: true })).ok).toBe(true)
      expect(existsSync(join(dir, 'fresh.txt'))).toBe(false)

      expect((await stashPop(dir, 'stash@{0}')).ok).toBe(true)
      expect(existsSync(join(dir, 'fresh.txt'))).toBe(true)
      expect(await listStashes(dir)).toEqual([])
    })

    it('非法 stash 引用被拒绝', async () => {
      const dir = seeded()
      expect((await stashDrop(dir, 'HEAD')).ok).toBe(false)
      expect((await stashPop(dir, '--all')).ok).toBe(false)
    })
  })

  describe('合并与变基', () => {
    function conflicting(): { dir: string; base: string } {
      const dir = seeded()
      const base = currentBranch(dir)
      run(dir, ['checkout', '-q', '-b', 'feat/conflict'])
      write(dir, 'a.txt', 'feat 版本\n')
      commit(dir, 'feat 改动')
      run(dir, ['checkout', '-q', base])
      write(dir, 'a.txt', 'main 版本\n')
      commit(dir, 'main 改动')
      return { dir, base }
    }

    it('merge 成功时带回新状态', async () => {
      const dir = seeded()
      const base = currentBranch(dir)
      run(dir, ['checkout', '-q', '-b', 'feat/ok'])
      write(dir, 'feature.txt', 'x\n')
      commit(dir, 'feature 提交')
      run(dir, ['checkout', '-q', base])

      const result = await mergeBranch(dir, 'feat/ok')
      expect(result.ok).toBe(true)
      expect(existsSync(join(dir, 'feature.txt'))).toBe(true)
    })

    it('merge 冲突时回传冲突文件，abort 可回到干净状态', async () => {
      const { dir } = conflicting()

      const result = await mergeBranch(dir, 'feat/conflict')
      expect(result.ok).toBe(false)
      expect(result.conflicts).toEqual(['a.txt'])

      const status = await integrationStatus(dir)
      expect(status.merging).toBe(true)
      expect(status.conflicts).toEqual(['a.txt'])
      expect(await listConflicts(dir)).toEqual(['a.txt'])

      expect((await abortIntegration(dir)).ok).toBe(true)
      expect((await integrationStatus(dir)).merging).toBe(false)
      expect(run(dir, ['status', '--porcelain'])).toBe('')
    })

    it('rebase 冲突时进入 rebasing 状态，abort 后回到原分支', async () => {
      const { dir } = conflicting()
      const before = currentBranch(dir)

      const result = await rebaseOnto(dir, 'feat/conflict')
      expect(result.ok).toBe(false)
      expect(result.conflicts).toEqual(['a.txt'])
      expect((await integrationStatus(dir)).rebasing).toBe(true)

      expect((await abortIntegration(dir)).ok).toBe(true)
      expect(currentBranch(dir)).toBe(before)
      expect((await integrationStatus(dir)).rebasing).toBe(false)
    })

    it('没有进行中的操作时 abort 明确失败', async () => {
      const dir = seeded()
      const result = await abortIntegration(dir)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('没有进行中')
    })
  })
})
