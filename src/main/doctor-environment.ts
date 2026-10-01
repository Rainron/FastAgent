import { existsSync } from 'node:fs'
import { resolveGitWorkspaceState } from './git'
import { resolveBashPath } from './agent/sandbox/shell-resolver'
import type { SandboxManager } from './agent/sandbox/sandbox-manager'
import type { Ability, AppSettings, DoctorCheck } from '../shared/types'

export interface EnvironmentCheckDeps {
  settings: AppSettings
  bundledTools: Record<string, string>
  sandboxManager: SandboxManager
  workspaceRoot: string | null
  listAbilities: () => Promise<Ability[]>
}

/**
 * Doctor 里依赖主进程运行时状态的那几项：shell、沙箱、工作区、能力。
 * 与 probeTools 分开，因为它们读的是模块级单例而不是外部可执行文件，没法做成纯函数。
 */
export async function environmentChecks(deps: EnvironmentCheckDeps): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []

  const shellName = deps.settings.shellPreference === 'powershell' ? 'powershell' : 'bash'
  if (shellName === 'bash' && process.platform === 'win32') {
    const bashPath = deps.settings.bashPath?.trim()
    const found = bashPath ? existsSync(bashPath) : Boolean(resolveBashPath({ bundledPath: deps.bundledTools.bash }))
    checks.push({
      id: 'shell', label: 'Shell（bash）', category: 'shell',
      status: found ? 'ok' : 'missing',
      detail: found ? (bashPath || (deps.bundledTools.bash ? '使用内置 bash' : '已在 PATH 中找到')) : '未找到 bash',
      ...(found ? {} : { hint: '内置工具链缺失时可安装 Git for Windows，或在设置里改用 PowerShell' })
    })
  } else {
    checks.push({ id: 'shell', label: `Shell（${shellName}）`, category: 'shell', status: 'ok', detail: '可用' })
  }

  try {
    const capabilities = await deps.sandboxManager.probe()
    const ready = capabilities.status === 'ready'
    const enabled = deps.settings.sandbox?.enabled !== false
    checks.push({
      id: 'sandbox', label: 'Agent 沙箱', category: 'sandbox',
      // 沙箱关着就不是问题，只是状态；开着却不可用才要提示
      status: ready ? 'ok' : enabled ? 'error' : 'warn',
      detail: ready ? '已就绪' : capabilities.reason ?? '不可用',
      ...(ready || !enabled ? {} : { hint: '到设置 - 沙箱页执行一次初始化' })
    })
  } catch (error) {
    checks.push({ id: 'sandbox', label: 'Agent 沙箱', category: 'sandbox', status: 'error', detail: error instanceof Error ? error.message : '探测失败' })
  }

  const root = deps.workspaceRoot
  if (!root) {
    checks.push({ id: 'workspace', label: '工作区', category: 'workspace', status: 'warn', detail: '未选择工作区', hint: '在输入框选择一个项目目录后 Agent 才能读写文件' })
  } else if (!existsSync(root)) {
    checks.push({ id: 'workspace', label: '工作区', category: 'workspace', status: 'error', detail: `目录不存在：${root}`, hint: '重新选择工作区目录' })
  } else {
    const git = await resolveGitWorkspaceState(root)
    checks.push({ id: 'workspace', label: '工作区', category: 'workspace', status: 'ok', detail: root })
    checks.push({
      id: 'git-repo', label: 'Git 仓库', category: 'workspace',
      status: git ? 'ok' : 'warn',
      detail: git ? `分支 ${git.branch}` : '当前工作区不是 Git 仓库',
      ...(git ? {} : { hint: '不是仓库时无法展示分支与改动，可在资源面板初始化' })
    })
  }

  try {
    const abilities = await deps.listAbilities()
    const enabled = abilities.filter((item) => item.enabled).length
    checks.push({ id: 'abilities', label: '已启用能力', category: 'abilities', status: 'ok', detail: `${enabled} / ${abilities.length} 项已启用` })
  } catch (error) {
    checks.push({ id: 'abilities', label: '已启用能力', category: 'abilities', status: 'error', detail: error instanceof Error ? error.message : '读取失败' })
  }

  return checks
}
