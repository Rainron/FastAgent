import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 一条项目自带的验证命令。 */
export interface VerificationCommand {
  id: string
  /** 界面与提示里显示的名字。 */
  label: string
  /** 要执行的命令原文，由模型通过 shell 工具执行，不由主进程直接跑。 */
  command: string
  /** 来自哪个清单文件，用于说明「为什么认为项目支持它」。 */
  source: string
  kind: 'test' | 'build' | 'lint' | 'typecheck'
}

/** 探测清单文件的读取结果。抽成接口是为了让检测逻辑保持纯函数，测试不碰磁盘。 */
export interface WorkspaceManifests {
  packageJson?: string
  pyprojectToml?: string
  cargoToml?: string
  goMod?: string
}

/** package.json 里认得出的脚本名 → 分类。顺序即展示顺序。 */
const NPM_SCRIPTS: Array<{ script: string; kind: VerificationCommand['kind']; label: string }> = [
  { script: 'typecheck', kind: 'typecheck', label: '类型检查' },
  { script: 'lint', kind: 'lint', label: 'Lint' },
  { script: 'test', kind: 'test', label: '测试' },
  { script: 'build', kind: 'build', label: '构建' }
]

/**
 * 包管理器按 lockfile 判定，不猜。
 * 用错包管理器的代价不是命令失败那么简单：npm install 会在 pnpm 项目里重写整棵依赖树。
 */
export function detectPackageManager(files: { hasPnpmLock?: boolean; hasYarnLock?: boolean; hasNpmLock?: boolean }): 'pnpm' | 'yarn' | 'npm' {
  if (files.hasPnpmLock) return 'pnpm'
  if (files.hasYarnLock) return 'yarn'
  return 'npm'
}

function parseScripts(packageJson: string): Set<string> {
  try {
    const parsed = JSON.parse(packageJson) as { scripts?: Record<string, unknown> }
    return new Set(Object.keys(parsed.scripts ?? {}))
  } catch {
    // package.json 坏了不该让整个探测失败，当作没有脚本
    return new Set()
  }
}

/**
 * 从清单文件推断项目支持哪些验证命令。
 *
 * 只认清单里确实声明过的：猜一条不存在的命令，模型会照着跑、失败、再重试，
 * 比不给建议更糟。Rust / Go 的测试命令是工具链固定的，有清单文件即可确定。
 */
export function detectVerificationCommands(manifests: WorkspaceManifests, packageManager: 'pnpm' | 'yarn' | 'npm' = 'npm'): VerificationCommand[] {
  const commands: VerificationCommand[] = []

  if (manifests.packageJson) {
    const scripts = parseScripts(manifests.packageJson)
    for (const entry of NPM_SCRIPTS) {
      if (!scripts.has(entry.script)) continue
      commands.push({
        id: `npm:${entry.script}`,
        label: entry.label,
        // npm 需要 run 前缀，pnpm / yarn 直接跟脚本名也可以，但统一带 run 更不容易出错
        command: `${packageManager} run ${entry.script}`,
        source: 'package.json',
        kind: entry.kind
      })
    }
  }

  if (manifests.pyprojectToml) {
    const content = manifests.pyprojectToml
    // 只在 pyproject 里确实提到该工具时才建议，避免推荐一个没装的命令
    if (/\bruff\b/.test(content)) commands.push({ id: 'py:ruff', label: 'Lint', command: 'ruff check .', source: 'pyproject.toml', kind: 'lint' })
    if (/\bmypy\b/.test(content)) commands.push({ id: 'py:mypy', label: '类型检查', command: 'mypy .', source: 'pyproject.toml', kind: 'typecheck' })
    if (/\bpytest\b/.test(content)) commands.push({ id: 'py:pytest', label: '测试', command: 'pytest', source: 'pyproject.toml', kind: 'test' })
  }

  if (manifests.cargoToml) {
    commands.push({ id: 'cargo:test', label: '测试', command: 'cargo test', source: 'Cargo.toml', kind: 'test' })
  }

  if (manifests.goMod) {
    commands.push({ id: 'go:test', label: '测试', command: 'go test ./...', source: 'go.mod', kind: 'test' })
  }

  return commands
}

/** 从磁盘读清单。读不到的文件留空，探测逻辑自己处理缺失。 */
export function readWorkspaceManifests(root: string): WorkspaceManifests & { packageManager: 'pnpm' | 'yarn' | 'npm' } {
  const read = (name: string): string | undefined => {
    const path = join(root, name)
    if (!existsSync(path)) return undefined
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  }
  return {
    packageJson: read('package.json'),
    pyprojectToml: read('pyproject.toml'),
    cargoToml: read('Cargo.toml'),
    goMod: read('go.mod'),
    packageManager: detectPackageManager({
      hasPnpmLock: existsSync(join(root, 'pnpm-lock.yaml')),
      hasYarnLock: existsSync(join(root, 'yarn.lock')),
      hasNpmLock: existsSync(join(root, 'package-lock.json'))
    })
  }
}

/**
 * 追加到系统提示的验证说明。
 *
 * 只告诉模型「有哪些命令可用」与「改完要验证」，执行仍然走 shell 工具，
 * 因此权限规则与沙箱一个都绕不过——不为验证另开执行路径。
 */
export function verificationPrompt(commands: readonly VerificationCommand[]): string {
  if (!commands.length) return ''
  const list = commands.map((command) => `- ${command.label}：\`${command.command}\`（来自 ${command.source}）`).join('\n')
  return [
    '',
    '',
    '本项目可用的验证命令：',
    list,
    '改完代码后必须实际跑一遍相关验证再判断任务完成——代码写出来不等于任务完成。',
    '验证失败时定位并修复，然后重跑同一条命令确认；连续修不好就如实报告失败与已尝试的手段，不要反复重试同一条命令。',
    '把验证步骤用 todowrite 记成 phase 为「验证」的待办，通过标 completed，失败标 failed。'
  ].join('\n')
}

/**
 * 验证命令的重复执行要豁免死循环守卫。
 *
 * 「跑测试 → 改代码 → 再跑同一条测试」是正确的工作方式，但入参完全相同，
 * DoomLoopGuard 会把第三次判成死循环并弹审批，把正常的验证循环打断。
 */
export function isVerificationCommand(command: string, commands: readonly VerificationCommand[]): boolean {
  const normalized = command.trim()
  return commands.some((item) => item.command === normalized)
}
