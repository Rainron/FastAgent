import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Windows 上 pi 的 bash 解析兜底会找到 System32 的 WSL stub（未装 WSL 时每次执行都报
 * WSL 错误），导致「完全访问」下 shell 工具依然全线不可用。这里在主进程侧做一次
 * 可用性探测：找不到能真正执行命令的 bash 就让上层改用 powershell，或用用户显式
 * 配置的 bashPath。
 */

export interface ResolveBashPathOptions {
  /** 用户在设置里显式指定的 bash 路径；优先于自动探测 */
  explicitPath?: string
  /** 内置工具链里的 bash；用户没显式指定时优先用它，这样未装 Git for Windows 的机器也有 bash */
  bundledPath?: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** 测试注入：替换真实存在性检查 */
  exists?: (path: string) => boolean
  /** 测试注入：替换真实探测 */
  probe?: (path: string) => boolean
}

function defaultProbe(bashPath: string): boolean {
  try {
    const result = spawnSync(bashPath, ['-c', 'echo __fa_probe_ok__'], {
      encoding: 'utf-8',
      timeout: 4000,
      windowsHide: true
    })
    return result.status === 0 && (result.stdout ?? '').includes('__fa_probe_ok__')
  } catch {
    return false
  }
}

/** Git Bash 常见安装位置，与 pi 的解析顺序保持一致。 */
function gitBashCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = []
  const programFiles = env.ProgramFiles
  if (programFiles) candidates.push(join(programFiles, 'Git', 'bin', 'bash.exe'))
  const programFilesX86 = env['ProgramFiles(x86)']
  if (programFilesX86) candidates.push(join(programFilesX86, 'Git', 'bin', 'bash.exe'))
  return candidates
}

/** PATH 上的 bash.exe 候选：逐目录拼接，不依赖 where（GUI 进程里可能被安全软件干扰）。 */
function pathCandidates(env: NodeJS.ProcessEnv): string[] {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const path = env[pathKey] ?? ''
  return path.split(delimiter).filter(Boolean).map((dir) => join(dir, 'bash.exe'))
}

/** 解析结果按进程缓存：探测要起子进程，不能每轮对话重复做。重启应用后重新探测。 */
let cached: { explicit: string | undefined; bundled: string | undefined; path: string | null } | null = null

export function resolveBashPath(options: ResolveBashPathOptions = {}): string | null {
  const { explicitPath, bundledPath, platform = process.platform, env = process.env, exists = existsSync, probe = defaultProbe } = options
  if (platform !== 'win32') return null
  const explicit = explicitPath?.trim() || undefined
  const bundled = bundledPath?.trim() || undefined
  if (cached && cached.explicit === explicit && cached.bundled === bundled) return cached.path
  // 顺序即优先级：用户显式指定 > 内置工具链 > 机器上装的 Git Bash > PATH。
  // 内置排在系统之前，才能保证「装了 FastAgent 就有 bash」这件事不依赖用户环境。
  const candidates = [...(explicit ? [explicit] : []), ...(bundled ? [bundled] : []), ...gitBashCandidates(env), ...pathCandidates(env)]
  let resolved: string | null = null
  for (const candidate of candidates) {
    if (!candidate || !exists(candidate)) continue
    if (probe(candidate)) { resolved = candidate; break }
  }
  cached = { explicit, bundled, path: resolved }
  return resolved
}

/** 测试场景下清掉缓存，避免用例间串味。 */
export function resetBashPathCache(): void {
  cached = null
}

/**
 * 实际启用哪个 shell 工具：
 * - 用户明确选 powershell → powershell；
 * - 非 Windows / 找到可用 bash → bash；
 * - Windows 上找不到可用 bash → 自动降级 powershell（系统必带），避免 WSL stub 报错。
 */
export function resolveShellToolName(preference: 'bash' | 'powershell', options: ResolveBashPathOptions = {}): 'bash' | 'powershell' {
  const platform = options.platform ?? process.platform
  if (preference === 'powershell') return 'powershell'
  if (platform !== 'win32') return 'bash'
  return resolveBashPath(options) ? 'bash' : 'powershell'
}
