import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 一次性样稿的存放目录（相对工作区根）。 */
export const PREVIEW_SCRATCH_DIR = '.fastagent/previews'

/**
 * 把样稿目录写进 .git/info/exclude：它是本机私有的忽略规则，不改用户提交的 .gitignore，
 * 也不会出现在 Git 面板的改动里。已有同名规则就不动；不是 git 仓库（或 .git 是 worktree 的文件指针）直接跳过。
 * 返回是否真的写入了。
 */
export function ensureGitExcluded(root: string, entry = `${PREVIEW_SCRATCH_DIR}/`): boolean {
  const gitDir = join(root, '.git')
  try {
    if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) return false
    const infoDir = join(gitDir, 'info')
    const excludePath = join(infoDir, 'exclude')
    const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
    const normalized = entry.replace(/\/+$/, '')
    const present = current.split(/\r?\n/).some((line) => {
      const rule = line.trim().replace(/^\//, '').replace(/\/+$/, '')
      return rule === normalized
    })
    if (present) return false
    mkdirSync(infoDir, { recursive: true })
    const eol = current.includes('\r\n') ? '\r\n' : '\n'
    const prefix = current && !current.endsWith('\n') ? eol : ''
    writeFileSync(excludePath, `${current}${prefix}# FastAgent 预览样稿${eol}${entry}${eol}`, 'utf8')
    return true
  } catch (error) {
    console.warn('[preview] 写入 .git/info/exclude 失败:', error)
    return false
  }
}
